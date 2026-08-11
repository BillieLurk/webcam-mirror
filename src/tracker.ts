import {
  PoseLandmarker,
  HandLandmarker,
  ImageSegmenter,
  FilesetResolver,
} from '@mediapipe/tasks-vision'
import type {
  NormalizedLandmark,
  PoseLandmarkerResult,
  HandLandmarkerResult,
  ImageSegmenterResult,
} from '@mediapipe/tasks-vision'

export type { NormalizedLandmark, PoseLandmarkerResult, HandLandmarkerResult, ImageSegmenterResult }

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
const POSE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task'
const HAND_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task'
const SEG_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite'

export class Tracker {
  private poseLandmarker: PoseLandmarker | null = null
  private handLandmarker: HandLandmarker | null = null
  private imageSegmenter: ImageSegmenter | null = null
  private lastTimestamp = -1

  async init(onProgress?: (msg: string) => void): Promise<void> {
    onProgress?.('Loading vision runtime...')
    const vision = await FilesetResolver.forVisionTasks(WASM_URL)

    onProgress?.('Loading pose model...')
    this.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: POSE_MODEL_URL,
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    })

    onProgress?.('Loading hand tracking model...')
    this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: HAND_MODEL_URL,
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    })

    onProgress?.('Loading segmentation model...')
    this.imageSegmenter = await ImageSegmenter.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: SEG_MODEL_URL,
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    })
  }

  detect(
    video: HTMLVideoElement,
    timestamp: number,
  ): { pose: PoseLandmarkerResult; hands: HandLandmarkerResult; segmentation: ImageSegmenterResult | null } | null {
    if (!this.poseLandmarker || !this.handLandmarker || !this.imageSegmenter) return null
    if (timestamp === this.lastTimestamp) return null
    this.lastTimestamp = timestamp

    const pose = this.poseLandmarker.detectForVideo(video, timestamp)
    const hands = this.handLandmarker.detectForVideo(video, timestamp)
    const segmentation = this.imageSegmenter.segmentForVideo(video, timestamp)
    return { pose, hands, segmentation }
  }

  isReady(): boolean {
    return this.poseLandmarker !== null && this.handLandmarker !== null
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
