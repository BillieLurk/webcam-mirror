/**
 * RobustVideoMatting (RVM) segmenter.
 *
 * Runs Peter Lin's RVM mobilenetv3 ONNX model via ONNX Runtime Web.
 * Produces a full-resolution alpha matte per frame with temporal consistency
 * via recurrent hidden states — far better edge quality than MediaPipe selfie_segmenter.
 *
 * Model: public/models/rvm_mobilenetv3.onnx (~14 MB)
 * GitHub: https://github.com/PeterL1n/RobustVideoMatting
 */

import * as ort from 'onnxruntime-web'

// Point ONNX Runtime at its WASM files (Vite serves node_modules as-is via ?url)
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/'

export interface AlphaMask {
  data: Float32Array   // per-pixel alpha, 0=background, 1=person, length = width*height
  width: number
  height: number
}

// Offscreen canvas for video → tensor conversion (reused each frame)
let srcCanvas: OffscreenCanvas | null = null
let srcCtx: OffscreenCanvasRenderingContext2D | null = null

export class RVMSegmenter {
  private session: ort.InferenceSession | null = null
  private r1: ort.Tensor | null = null
  private r2: ort.Tensor | null = null
  private r3: ort.Tensor | null = null
  private r4: ort.Tensor | null = null

  // Downsample ratio: 0.25 = fast (320×180 internal at 720p), 0.5 = higher quality
  downsampleRatio = 0.25

  async init(onProgress?: (msg: string) => void): Promise<void> {
    onProgress?.('Loading RVM segmentation model...')
    this.session = await ort.InferenceSession.create('/models/rvm_mobilenetv3.onnx', {
      executionProviders: ['webgl', 'wasm'],
      graphOptimizationLevel: 'all',
    })
    this.resetState()
  }

  /** Reset recurrent state — call when video source changes or after a long pause. */
  resetState() {
    const zero = () => new ort.Tensor('float32', new Float32Array([0]), [1, 1, 1, 1])
    this.r1 = zero(); this.r2 = zero(); this.r3 = zero(); this.r4 = zero()
  }

  async segment(video: HTMLVideoElement): Promise<AlphaMask | null> {
    if (!this.session || !this.r1 || !this.r2 || !this.r3 || !this.r4) return null

    const W = video.videoWidth
    const H = video.videoHeight
    if (!W || !H) return null

    // Draw video into offscreen canvas to extract pixel data
    if (!srcCanvas || srcCanvas.width !== W || srcCanvas.height !== H) {
      srcCanvas = new OffscreenCanvas(W, H)
      srcCtx = srcCanvas.getContext('2d')!
    }
    srcCtx!.drawImage(video, 0, 0, W, H)
    const { data } = srcCtx!.getImageData(0, 0, W, H)

    // Convert RGBA uint8 → RGB float32 planar [1, 3, H, W], normalized 0–1
    const numPx = W * H
    const rgb = new Float32Array(3 * numPx)
    for (let i = 0; i < numPx; i++) {
      rgb[i]             = data[i * 4]     / 255  // R plane
      rgb[i + numPx]     = data[i * 4 + 1] / 255  // G plane
      rgb[i + 2 * numPx] = data[i * 4 + 2] / 255  // B plane
    }
    const src = new ort.Tensor('float32', rgb, [1, 3, H, W])

    const feeds = {
      src,
      r1i: this.r1,
      r2i: this.r2,
      r3i: this.r3,
      r4i: this.r4,
      downsample_ratio: new ort.Tensor('float32', [this.downsampleRatio]),
    }

    const results = await this.session.run(feeds)

    // Update recurrent states for next frame (temporal consistency)
    this.r1 = results['r1o'] as ort.Tensor
    this.r2 = results['r2o'] as ort.Tensor
    this.r3 = results['r3o'] as ort.Tensor
    this.r4 = results['r4o'] as ort.Tensor

    // Alpha matte: [1, 1, H, W] float32, 0=background, 1=person
    const pha = results['pha'] as ort.Tensor
    return { data: pha.data as Float32Array, width: W, height: H }
  }

  get ready(): boolean { return this.session !== null }
}
