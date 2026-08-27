/**
 * RobustVideoMatting (RVM) segmenter — worker-backed.
 *
 * Runs inference in a Web Worker so the main animation loop is never blocked.
 * The worker tries WebGPU → WebGL → WASM in order of preference.
 *
 * Model: public/models/rvm_mobilenetv3.onnx (~7 MB fp16)
 * GitHub: https://github.com/PeterL1n/RobustVideoMatting
 */

export interface AlphaMask {
  data: Float32Array   // per-pixel alpha, 0=background, 1=person, length = width*height
  width: number
  height: number
}

// Small canvas for extracting pixel data from video/canvas each frame (main thread)
let srcCanvas: OffscreenCanvas | null = null
let srcCtx: OffscreenCanvasRenderingContext2D | null = null

export class RVMSegmenter {
  private worker: Worker | null = null
  private pendingResolve: ((mask: AlphaMask | null) => void) | null = null
  private _ready = false
  private _backend = 'unknown'

  /** Resolution divisor: source is fed at 1/N size. Lower = faster, higher = better edges. */
  downsampleFactor = 2

  async init(onProgress?: (msg: string) => void): Promise<void> {
    onProgress?.('Loading RVM segmentation model...')

    this.worker = new Worker(
      new URL('./segmenter.worker.ts', import.meta.url),
      { type: 'module' },
    )

    // Persistent message handler for both init and ongoing segment responses
    this.worker.onmessage = (e: MessageEvent) => {
      const { type } = e.data
      if (type === 'ready') {
        this._ready = true
        const backend: string = e.data.backend ?? 'wasm'
        this._backend = backend
        onProgress?.(`Segmentation ready (${backend})`)
        this._initResolve?.()
        this._initResolve = null
      } else if (type === 'error') {
        this._initReject?.(new Error(e.data.message))
        this._initResolve = null
        this._initReject = null
      } else if (type === 'mask') {
        this.pendingResolve?.({ data: e.data.data, width: e.data.width, height: e.data.height })
        this.pendingResolve = null
      } else if (type === 'skip') {
        this.pendingResolve?.(null)
        this.pendingResolve = null
      } else if (type === 'backend') {
        this._backend = e.data.backend
        console.log(`[segmenter] switched to backend: ${e.data.backend}`)
      }
    }

    await new Promise<void>((resolve, reject) => {
      this._initResolve = resolve
      this._initReject = reject
      this.worker!.postMessage({ type: 'init' })
    })
  }

  private _initResolve: (() => void) | null = null
  private _initReject: ((e: Error) => void) | null = null

  /** Reset recurrent state — call when video source changes or after a long pause. */
  resetState() {
    this.worker?.postMessage({ type: 'reset' })
  }

  async segment(source: HTMLVideoElement | HTMLCanvasElement): Promise<AlphaMask | null> {
    if (!this.worker || !this._ready) return null
    // Drop frame if previous result hasn't been picked up yet
    if (this.pendingResolve) { return null }

    const W = source instanceof HTMLVideoElement ? source.videoWidth  : source.width
    const H = source instanceof HTMLVideoElement ? source.videoHeight : source.height
    if (!W || !H) return null

    const IW = Math.max(1, Math.round(W / this.downsampleFactor))
    const IH = Math.max(1, Math.round(H / this.downsampleFactor))

    // Draw source into offscreen canvas to extract pixel data
    if (!srcCanvas || srcCanvas.width !== IW || srcCanvas.height !== IH) {
      srcCanvas = new OffscreenCanvas(IW, IH)
      srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true })!
    }
    srcCtx!.drawImage(source, 0, 0, IW, IH)
    const imageData = srcCtx!.getImageData(0, 0, IW, IH)

    // Transfer pixel buffer to worker (zero-copy — no serialization overhead)
    const rgba = imageData.data.buffer

    return new Promise((resolve) => {
      this.pendingResolve = resolve
      this.worker!.postMessage({ type: 'segment', rgba, width: IW, height: IH }, [rgba])
    })
  }

  get ready(): boolean { return this._ready }
  get backend(): string { return this._backend }
}
