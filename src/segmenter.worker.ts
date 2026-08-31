/// <reference lib="webworker" />
/**
 * RVM segmentation Web Worker.
 * Runs ONNX inference off the main thread so the animation loop is never blocked.
 *
 * Uses the WASM (CPU, multi-threaded SIMD) backend: measured ~3x faster than WebGPU
 * for this model on this hardware (~25-30ms/frame vs ~85-90ms/frame), despite WebGPU
 * confirmed running on real GPU hardware (not a software fallback) — ONNX Runtime
 * Web's generic WebGPU op-by-op dispatch carries more overhead than its WASM SIMD path
 * for a model this small.
 */
import * as ort from 'onnxruntime-web'

// Multi-threading requires SharedArrayBuffer (enabled by COOP/COEP credentialless headers).
// Falls back to 1 thread automatically if SAB is unavailable.
ort.env.wasm.numThreads = typeof SharedArrayBuffer !== 'undefined' ? Math.min(navigator.hardwareConcurrency ?? 4, 8) : 1
ort.env.wasm.wasmPaths = '/ort/'

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
      session = await tryCreate(['wasm'])
      if (!session) throw new Error('No ONNX backend available')
      resetState()
      self.postMessage({ type: 'ready', backend: 'wasm' })
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

    const { bitmap, width: IW, height: IH } = e.data as { bitmap: ImageBitmap, width: number, height: number }
    // fromImage produces the same RGB/NCHW/float32/[0,1]-normalized tensor a manual
    // drawImage+getImageData+per-pixel-loop would, via ORT's own (faster) conversion path.
    const src = await ort.Tensor.fromImage(bitmap, {}) as ort.Tensor
    bitmap.close()
    const dsRatio = new ort.Tensor('float32', [DOWNSAMPLE_RATIO])
    const feeds = {
      src,
      r1i: r1, r2i: r2!, r3i: r3!, r4i: r4!,
      downsample_ratio: dsRatio,
    }

    try {
      const results = await session.run(feeds)
      src.dispose(); dsRatio.dispose()
      // Dispose old recurrent state tensors before replacing
      r1?.dispose(); r2?.dispose(); r3?.dispose(); r4?.dispose()
      r1 = results['r1o'] as ort.Tensor
      r2 = results['r2o'] as ort.Tensor
      r3 = results['r3o'] as ort.Tensor
      r4 = results['r4o'] as ort.Tensor

      const pha = results['pha'] as ort.Tensor
      const alpha = new Float32Array(pha.data as ArrayLike<number>)
      self.postMessage({ type: 'mask', data: alpha, width: IW, height: IH }, [alpha.buffer])
    } catch (err) {
      const errStr = err instanceof Error ? `${err.name}: ${err.message}\n${(err as Error).stack}` : String(err)
      console.error('[rvm worker] inference error:', errStr)
      self.postMessage({ type: 'skip' })
    }
  }
}
