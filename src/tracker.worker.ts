/// <reference lib="webworker" />
/**
 * Pose OR hand tracking Web Worker — the same script runs as two separate worker
 * instances (one per landmarker), so pose and hand detection execute in true parallel
 * on separate threads instead of sequentially in one worker. Sequential execution in a
 * single worker measured ~35-70ms combined; each landmarker alone is the dominant cost,
 * so splitting them roughly halves the round-trip.
 *
 * Uses the CPU delegate: the GPU delegate leaked inside a worker (per-call latency
 * climbed steadily over time — 22ms -> 100ms+ within ~15s), which the CPU delegate does
 * not do; consistent with WebGPU/GPU-delegate instability seen elsewhere in this app on
 * this Wayland setup (see segmenter.worker.ts).
 */
import {
  PoseLandmarker,
  HandLandmarker,
  FilesetResolver,
} from '@mediapipe/tasks-vision'
import type { PoseLandmarkerResult, HandLandmarkerResult } from '@mediapipe/tasks-vision'

const WASM_URL = '/mediapipe-wasm'
const POSE_MODEL_URL = '/models/pose_landmarker_lite.task'
const HAND_MODEL_URL = '/models/hand_landmarker.task'

type Kind = 'pose' | 'hand'
let kind: Kind = 'pose'
let poseLandmarker: PoseLandmarker | null = null
let handLandmarker: HandLandmarker | null = null

self.onmessage = async (e: MessageEvent) => {
  const { type } = e.data

  if (type === 'init') {
    kind = e.data.kind as Kind
    try {
      const vision = await FilesetResolver.forVisionTasks(WASM_URL)
      if (kind === 'pose') {
        poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate: 'CPU' },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        })
      } else {
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate: 'CPU' },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        })
      }
      self.postMessage({ type: 'ready' })
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err) })
    }
    return
  }

  if (type === 'detect') {
    const { bitmap, timestamp } = e.data as { bitmap: ImageBitmap, timestamp: number }
    const landmarker = kind === 'pose' ? poseLandmarker : handLandmarker
    if (!landmarker) { bitmap.close(); self.postMessage({ type: 'skip' }); return }

    try {
      const result: PoseLandmarkerResult | HandLandmarkerResult = landmarker.detectForVideo(bitmap, timestamp)
      bitmap.close()
      self.postMessage({ type: 'result', result })
    } catch (err) {
      bitmap.close()
      console.error(`[tracker worker:${kind}] detect error:`, err)
      self.postMessage({ type: 'skip' })
    }
  }
}
