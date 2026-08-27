/// <reference lib="webworker" />
/**
 * RVM segmentation Web Worker.
 * Runs ONNX inference off the main thread so the animation loop is never blocked.
 * Tries WebGPU (GPU, fast) → WebGL (GPU, compat) → WASM (CPU, fallback).
 */
import * as ort from 'onnxruntime-web'

// Multi-threading requires SharedArrayBuffer (enabled by COOP/COEP credentialless headers).
// Falls back to 1 thread automatically if SAB is unavailable.
ort.env.wasm.numThreads = typeof SharedArrayBuffer !== 'undefined' ? Math.min(navigator.hardwareConcurrency ?? 4, 8) : 1
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.29.0/dist/'

const DOWNSAMPLE_RATIO = 0.4

let session: ort.InferenceSession | null = null
let r1: ort.Tensor | null = null
let r2: ort.Tensor | null = null
let r3: ort.Tensor | null = null
let r4: ort.Tensor | null = null

function resetState() {
  const zero = () => new ort.Tensor('float32', new Float32Array([0]), [1, 1, 1, 1])
  r1 = zero(); r2 = zero(); r3 = zero(); r4 = zero()
}

async function tryCreate(providers: string[]): Promise<ort.InferenceSession | null> {
  try {
    return await ort.InferenceSession.create('/models/rvm_mobilenetv3_fp32.onnx', {
      executionProviders: providers,
      graphOptimizationLevel: 'all',
    })
  } catch (err) {
    console.warn(`[rvm worker] ${providers[0]} backend failed:`, err)
    return null
  }
}

self.onmessage = async (e: MessageEvent) => {
  const { type } = e.data

  if (type === 'init') {
    try {
      let backend = 'wasm'
      session = await tryCreate(['webgpu'])
      if (session) backend = 'webgpu'
      if (!session) { session = await tryCreate(['webgl']); if (session) backend = 'webgl' }
      if (!session) { session = await tryCreate(['wasm']); }
      if (!session) throw new Error('No ONNX backend available')
      resetState()
      self.postMessage({ type: 'ready', backend })
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err) })
    }
    return
  }

  if (type === 'reset') {
    resetState()
    return
  }

  if (type === 'segment') {
    if (!session || !r1) { self.postMessage({ type: 'skip' }); return }

    const { rgba, width: IW, height: IH } = e.data
    const data = new Uint8ClampedArray(rgba)

    const numPx = IW * IH
    const rgb32 = new Float32Array(3 * numPx)
    for (let i = 0; i < numPx; i++) {
      rgb32[i]             = data[i * 4]     / 255
      rgb32[i + numPx]     = data[i * 4 + 1] / 255
      rgb32[i + 2 * numPx] = data[i * 4 + 2] / 255
    }

    const src = new ort.Tensor('float32', rgb32, [1, 3, IH, IW])
    const dsRatio = new ort.Tensor('float32', [DOWNSAMPLE_RATIO])
    const feeds = {
      src,
      r1i: r1, r2i: r2!, r3i: r3!, r4i: r4!,
      downsample_ratio: dsRatio,
    }

    try {
      const results = await session.run(feeds)
      src.dispose(); dsRatio.dispose()
      // Dispose old recurrent state tensors to free GPU buffers before replacing
      r1?.dispose(); r2?.dispose(); r3?.dispose(); r4?.dispose()
      r1 = results['r1o'] as ort.Tensor
      r2 = results['r2o'] as ort.Tensor
      r3 = results['r3o'] as ort.Tensor
      r4 = results['r4o'] as ort.Tensor

      const pha = results['pha'] as ort.Tensor
      const alpha = new Float32Array(pha.data as ArrayLike<number>)
      // Debug: log alpha stats on first few frames to verify model output
      if (alpha.length > 0 && Math.random() < 0.02) {
        let sum = 0, mn = 1, mx = 0
        for (let i = 0; i < alpha.length; i++) { sum += alpha[i]; if (alpha[i] < mn) mn = alpha[i]; if (alpha[i] > mx) mx = alpha[i] }
        console.log(`[rvm] alpha mean=${(sum/alpha.length).toFixed(3)} min=${mn.toFixed(3)} max=${mx.toFixed(3)} dims=${pha.dims}`)
      }
      self.postMessage({ type: 'mask', data: alpha, width: IW, height: IH }, [alpha.buffer])
    } catch (err) {
      const errStr = err instanceof Error ? `${err.name}: ${err.message}\n${(err as Error).stack}` : String(err)
      console.error('[rvm worker] inference error:', errStr)
      // Only fall back to WASM if we're currently on a GPU backend (avoid re-creating on every frame)
      const wasGpu = session !== null
      if (wasGpu) {
        try { (session as any).release?.() } catch {}
        session = null
        console.warn('[rvm worker] GPU backend failed — falling back to multi-threaded WASM')
        session = await tryCreate(['wasm'])
        if (!session) {
          self.postMessage({ type: 'error', message: 'All ONNX backends failed' })
          return
        }
        resetState()
        self.postMessage({ type: 'backend', backend: 'wasm-fallback' })
      }
      self.postMessage({ type: 'skip' })
    }
  }
}
