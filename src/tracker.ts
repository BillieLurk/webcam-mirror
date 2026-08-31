import type {
  NormalizedLandmark,
  PoseLandmarkerResult,
  HandLandmarkerResult,
} from '@mediapipe/tasks-vision'

export type { NormalizedLandmark, PoseLandmarkerResult, HandLandmarkerResult }

export interface TrackResult {
  pose: PoseLandmarkerResult
  hands: HandLandmarkerResult
}

/** One landmarker's worker connection — pose and hand run as separate worker instances so they execute in parallel. */
class LandmarkerWorker<TResult> {
  private worker: Worker | null = null
  private _ready = false
  private pendingResolve: ((result: TResult | null) => void) | null = null
  private _initResolve: (() => void) | null = null
  private _initReject: ((e: Error) => void) | null = null

  async init(kind: 'pose' | 'hand'): Promise<void> {
    // Classic (non-module) worker: MediaPipe's WASM loader calls importScripts()
    // internally when it detects a Worker context, which throws in a module worker
    // ("Module scripts don't support importScripts()"). Vite still bundles our own
    // `import` statements in tracker.worker.ts fine for a classic worker (IIFE output).
    this.worker = new Worker(new URL('./tracker.worker.ts', import.meta.url))

    this.worker.onmessage = (e: MessageEvent) => {
      const { type } = e.data
      if (type === 'ready') {
        this._ready = true
        this._initResolve?.()
        this._initResolve = null
      } else if (type === 'error') {
        this._initReject?.(new Error(e.data.message))
        this._initResolve = null
        this._initReject = null
      } else if (type === 'result') {
        this.pendingResolve?.(e.data.result)
        this.pendingResolve = null
      } else if (type === 'skip') {
        this.pendingResolve?.(null)
        this.pendingResolve = null
      }
    }

    await new Promise<void>((resolve, reject) => {
      this._initResolve = resolve
      this._initReject = reject
      this.worker!.postMessage({ type: 'init', kind })
    })
  }

  get ready(): boolean { return this._ready }
  get busy(): boolean { return this.pendingResolve !== null }

  detect(bitmap: ImageBitmap, timestamp: number): Promise<TResult | null> {
    return new Promise((resolve) => {
      this.pendingResolve = resolve
      this.worker!.postMessage({ type: 'detect', bitmap, timestamp }, [bitmap])
    })
  }
}

export class Tracker {
  private poseWorker = new LandmarkerWorker<PoseLandmarkerResult>()
  private handWorker = new LandmarkerWorker<HandLandmarkerResult>()

  async init(onProgress?: (msg: string) => void): Promise<void> {
    onProgress?.('Loading vision runtime...')
    await Promise.all([
      this.poseWorker.init('pose'),
      this.handWorker.init('hand'),
    ])
    onProgress?.('Tracking ready')
  }

  async detect(source: HTMLVideoElement | HTMLCanvasElement, timestamp: number): Promise<TrackResult | null> {
    if (!this.poseWorker.ready || !this.handWorker.ready) return null
    // Drop frame if either worker hasn't picked up its previous result yet
    if (this.poseWorker.busy || this.handWorker.busy) return null

    // Two independent bitmaps: each is a transferable, consumed by exactly one worker.
    const [poseBitmap, handBitmap] = await Promise.all([
      createImageBitmap(source),
      createImageBitmap(source),
    ])

    const [pose, hands] = await Promise.all([
      this.poseWorker.detect(poseBitmap, timestamp),
      this.handWorker.detect(handBitmap, timestamp),
    ])
    if (!pose || !hands) return null
    return { pose, hands }
  }

  isReady(): boolean {
    return this.poseWorker.ready && this.handWorker.ready
  }
}

/**
 * Returns true when the hand is closed (fist/grab): at least 3 of 4 fingers have
 * their tip closer to the wrist than their MCP knuckle, meaning they are curled in.
 */
export function detectFist(landmarks: NormalizedLandmark[]): boolean {
  if (landmarks.length < 21) return false
  const wrist = landmarks[0]

  // [MCP, TIP] pairs for index, middle, ring, pinky
  const fingers: [number, number][] = [[5, 8], [9, 12], [13, 16], [17, 20]]

  let curled = 0
  for (const [mcp, tip] of fingers) {
    const mcpLm = landmarks[mcp]
    const tipLm = landmarks[tip]
    const mcpDist = Math.hypot(mcpLm.x - wrist.x, mcpLm.y - wrist.y)
    const tipDist = Math.hypot(tipLm.x - wrist.x, tipLm.y - wrist.y)
    if (tipDist < mcpDist * 1.3) curled++
  }

  return curled >= 3
}

/** Midpoint between thumb tip and index tip — the "pinch point". */
export function getPinchPoint(landmarks: NormalizedLandmark[]): { x: number; y: number } {
  const thumb = landmarks[4]
  const index = landmarks[8]
  return { x: (thumb.x + index.x) / 2, y: (thumb.y + index.y) / 2 }
}

/** Normalized palm center (average of wrist + knuckles). */
export function getPalmCenter(landmarks: NormalizedLandmark[]): { x: number; y: number } {
  const indices = [0, 5, 9, 13, 17]
  let x = 0, y = 0
  for (const i of indices) { x += landmarks[i].x; y += landmarks[i].y }
  return { x: x / indices.length, y: y / indices.length }
}
