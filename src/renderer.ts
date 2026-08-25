import type { NormalizedLandmark, PoseLandmarkerResult, HandLandmarkerResult, ImageSegmenterResult } from './tracker'
import type { FloatingObject } from './physics'
import type { DepthFrame } from './depth-receiver'
import type { ImageInfo, ProductInfo } from './assets'
import { detectFist, getPalmCenter } from './tracker'

// Offscreen canvases for background replacement compositing, lazily created
let offVideo: OffscreenCanvas | null = null
let offVideoCtx: OffscreenCanvasRenderingContext2D | null = null

// Temporal smoothing buffer for depth background alpha — reduces flicker between frames
let prevDepthAlpha: Float32Array | null = null

function ensureOffscreen(w: number, h: number) {
  if (!offVideo || offVideo.width !== w || offVideo.height !== h) {
    offVideo = new OffscreenCanvas(w, h)
    offVideoCtx = offVideo.getContext('2d')!
  }
}

function sampleBilinear(arr: Float32Array, mw: number, mh: number, fx: number, fy: number): number {
  const x0 = Math.floor(fx), x1 = Math.min(x0 + 1, mw - 1)
  const y0 = Math.floor(fy), y1 = Math.min(y0 + 1, mh - 1)
  const tx = fx - x0, ty = fy - y0
  const v00 = arr[y0 * mw + x0], v10 = arr[y0 * mw + x1]
  const v01 = arr[y1 * mw + x0], v11 = arr[y1 * mw + x1]
  return (1 - ty) * ((1 - tx) * v00 + tx * v10) + ty * ((1 - tx) * v01 + tx * v11)
}

function drawWithBackground(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  segmentation: { confidenceMasks?: Array<{ getAsFloat32Array(): Float32Array; width: number; height: number }> },
  bgColor: string,
  W: number,
  H: number,
) {
  ensureOffscreen(W, H)
  const oc = offVideoCtx!

  // Draw mirrored video into offscreen canvas
  oc.save()
  oc.translate(W, 0)
  oc.scale(-1, 1)
  oc.drawImage(video, 0, 0, W, H)
  oc.restore()

  const videoData = oc.getImageData(0, 0, W, H)
  const pixels = videoData.data

  // confidenceMasks[0] = person confidence (class 0), 1.0 = definitely person
  const maskImg = segmentation.confidenceMasks![0]
  const maskArr = maskImg.getAsFloat32Array()
  const maskW = maskImg.width
  const maskH = maskImg.height

  const bg = parseCssColor(bgColor)

  for (let cy = 0; cy < H; cy++) {
    // Un-mirror x: canvas left = video right
    const fy = (cy / H) * maskH
    for (let cx = 0; cx < W; cx++) {
      const videoX = W - 1 - cx
      const fx = (videoX / W) * maskW

      // Bilinear sample gives a smooth gradient at person edges
      const personConf = sampleBilinear(maskArr, maskW, maskH, fx, fy)
      const bgAlpha = 1 - personConf

      if (bgAlpha > 0) {
        const pi = (cy * W + cx) * 4
        pixels[pi]     = (pixels[pi]     * personConf + bg[0] * bgAlpha) | 0
        pixels[pi + 1] = (pixels[pi + 1] * personConf + bg[1] * bgAlpha) | 0
        pixels[pi + 2] = (pixels[pi + 2] * personConf + bg[2] * bgAlpha) | 0
      }
    }
  }

  ctx.putImageData(videoData, 0, 0)
}

/**
 * Depth-camera compositing path.
 * The iPhone sends its own color frame (already the right source of truth)
 * alongside per-pixel depth in metres. Pixels beyond `threshold` metres are
 * replaced with the solid background color.
 *
 * The color frame is landscape from the rear camera so we rotate it 90°
 * by drawing it transposed onto an offscreen canvas.
 */
function drawWithDepth(
  ctx: CanvasRenderingContext2D,
  frame: DepthFrame,
  bgColor: string,
  W: number,
  H: number,
  threshold: number,
) {
  ensureOffscreen(W, H)
  const oc = offVideoCtx!

  // Draw the iPhone color frame scaled to canvas (it arrives as landscape bitmap)
  oc.clearRect(0, 0, W, H)
  oc.drawImage(frame.colorBitmap, 0, 0, W, H)

  const imageData = oc.getImageData(0, 0, W, H)
  const pixels = imageData.data
  const bg = parseCssColor(bgColor)

  const { depthData, depthWidth: dw, depthHeight: dh } = frame

  const THRESHOLD = threshold  // metres — person closer than this is kept
  const EDGE      = 0.3  // soft transition zone width (metres either side of threshold)
  const TEMPORAL  = 0.55 // how much of the previous frame's alpha to blend in (0=none, higher=smoother)

  const numPixels = W * H
  if (!prevDepthAlpha || prevDepthAlpha.length !== numPixels) {
    prevDepthAlpha = new Float32Array(numPixels)
  }

  for (let cy = 0; cy < H; cy++) {
    const fy = (cy / H) * dh
    for (let cx = 0; cx < W; cx++) {
      const fx = (cx / W) * dw
      const depth = sampleBilinear(depthData, dw, dh, fx, fy)

      // Raw background alpha: 0 = fully person, 1 = fully background
      let raw: number
      if (depth === 0) {
        raw = 1  // no sensor data → background
      } else if (depth < THRESHOLD - EDGE) {
        raw = 0  // clearly in front
      } else if (depth > THRESHOLD + EDGE) {
        raw = 1  // clearly behind
      } else {
        // Smooth S-curve across the edge zone
        const t = (depth - (THRESHOLD - EDGE)) / (2 * EDGE)
        raw = t * t * (3 - 2 * t)  // smoothstep
      }

      // Temporal blend: mix with previous frame to suppress flicker
      const pi = cy * W + cx
      const alpha = prevDepthAlpha[pi] * TEMPORAL + raw * (1 - TEMPORAL)
      prevDepthAlpha[pi] = alpha

      if (alpha > 0.01) {
        const idx = pi * 4
        pixels[idx]     = ((pixels[idx]     * (1 - alpha)) + bg[0] * alpha) | 0
        pixels[idx + 1] = ((pixels[idx + 1] * (1 - alpha)) + bg[1] * alpha) | 0
        pixels[idx + 2] = ((pixels[idx + 2] * (1 - alpha)) + bg[2] * alpha) | 0
      }
    }
  }

  ctx.putImageData(imageData, 0, 0)
}

/** Parse a CSS hex color like "#rrggbb" into [r, g, b]. */
function parseCssColor(hex: string): [number, number, number] {
  const c = hex.replace('#', '')
  return [
    parseInt(c.slice(0, 2), 16),
    parseInt(c.slice(2, 4), 16),
    parseInt(c.slice(4, 6), 16),
  ]
}

// All pose skeleton connections
const POSE_CONNECTIONS: [number, number][] = [
  [0, 11], [0, 12],       // head to shoulders
  [11, 12],               // shoulders
  [11, 13], [13, 15],     // left arm
  [12, 14], [14, 16],     // right arm
  [11, 23], [12, 24],     // torso sides
  [23, 24],               // hips
  [23, 25], [25, 27],     // left leg
  [24, 26], [26, 28],     // right leg
  [27, 29], [29, 31],     // left foot
  [28, 30], [30, 32],     // right foot
]

// Connections that have midpoint physics bodies — these actively push objects
const PUSHING_CONNECTIONS = new Set([
  '11,12', '11,13', '13,15', '12,14', '14,16',
  '11,23', '12,24', '23,24',
  '23,25', '25,27', '24,26', '26,28',
])

// Limb pairs that have intermediate collider bodies (matches main.ts LIMB_PAIRS)
const LIMB_PAIRS: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28],
]
const LIMB_STEPS = [0.25, 0.5, 0.75]
// Physics body radius matching main.ts BODY_RADIUS
const COLLIDER_RADIUS = 26

// Joints that are physics collision bodies
const PUSHING_JOINTS = new Set([0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28])

const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],           // thumb
  [0, 5], [5, 6], [6, 7], [7, 8],           // index
  [5, 9], [9, 10], [10, 11], [11, 12],      // middle
  [9, 13], [13, 14], [14, 15], [15, 16],    // ring
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20], // pinky + palm
]

/** Convert normalized MediaPipe landmark to mirrored canvas coordinates. */
function lm2c(lm: NormalizedLandmark, W: number, H: number): [number, number] {
  return [(1 - lm.x) * W, lm.y * H]
}

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  objects: FloatingObject[],
  poseResult: PoseLandmarkerResult | null,
  handResult: HandLandmarkerResult | null,
  debugMode: boolean,
  grabbing: Map<number, boolean>,
  hoverObjects: Set<FloatingObject>,
  images: Map<string, ImageInfo>,
  segmentation: Pick<ImageSegmenterResult, 'confidenceMasks'> | null,
  bgColor: string,
  bgEnabled: boolean,
  depthFrame: DepthFrame | null,
  depthThreshold: number,
  productInfo: Record<string, ProductInfo>,
) {
  const { width: W, height: H } = ctx.canvas

  ctx.clearRect(0, 0, W, H)

  if (depthFrame) {
    // Depth camera path: use iPhone color + depth for background removal
    drawWithDepth(ctx, depthFrame, bgColor, W, H, depthThreshold)
  } else if (bgEnabled && segmentation?.confidenceMasks?.length) {
    // ML segmentation path: webcam + MediaPipe confidence mask
    drawWithBackground(ctx, video, segmentation, bgColor, W, H)
  } else {
    // Plain mirrored webcam
    ctx.save()
    ctx.translate(W, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(video, 0, 0, W, H)
    ctx.restore()
  }

  // Subtle dark vignette to improve contrast of overlays
  ctx.fillStyle = 'rgba(0,0,0,0.12)'
  ctx.fillRect(0, 0, W, H)

  // Physics objects
  for (const obj of objects) {
    drawObject(ctx, obj, images, hoverObjects.has(obj), debugMode)
    if (obj.cardProgress > 0) {
      const info = productInfo[obj.imageKey]
      if (info) drawDescriptionCard(ctx, obj, info)
    }
  }

  // Debug: pose skeleton
  if (debugMode && poseResult && poseResult.landmarks.length > 0) {
    drawPoseSkeleton(ctx, poseResult.landmarks[0], W, H)
  }

  // Hand overlays (always show grab/pinch feedback)
  if (handResult) {
    for (let i = 0; i < handResult.landmarks.length; i++) {
      const lms = handResult.landmarks[i]
      const pinching = detectFist(lms)
      const isGrabbing = grabbing.get(i) ?? false
      drawHandOverlay(ctx, lms, W, H, pinching, isGrabbing, debugMode)
    }
  }
}

function drawObject(
  ctx: CanvasRenderingContext2D,
  obj: FloatingObject,
  images: Map<string, ImageInfo>,
  hovered = false,
  debugMode = false,
) {
  const { x, y } = obj.body.position
  const angle = obj.body.angle
  const info = images.get(obj.imageKey)

  ctx.save()
  ctx.globalAlpha = obj.alpha
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.scale(obj.scale, obj.scale)

  const ringR = Math.max(obj.drawW, obj.drawH) / 2 + 8

  // Grabbed highlight ring
  if (obj.grabbed) {
    ctx.beginPath()
    ctx.arc(0, 0, ringR, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'
    ctx.lineWidth = 3
    ctx.shadowBlur = 24
    ctx.shadowColor = '#ffffff'
    ctx.stroke()
    ctx.shadowBlur = 0
  } else if (hovered) {
    // Hover highlight — softer, dashed ring
    ctx.beginPath()
    ctx.arc(0, 0, ringR, 0, Math.PI * 2)
    ctx.setLineDash([6, 5])
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'
    ctx.lineWidth = 2
    ctx.shadowBlur = 12
    ctx.shadowColor = 'rgba(255,255,255,0.6)'
    ctx.stroke()
    ctx.setLineDash([])
    ctx.shadowBlur = 0
  }

  if (info) {
    // drawX/drawY are pre-computed so content center sits at local (0,0)
    ctx.drawImage(info.el, obj.drawX, obj.drawY, obj.drawW, obj.drawH)
  } else {
    ctx.fillStyle = 'rgba(200,200,200,0.4)'
    ctx.fillRect(-50, -50, 100, 100)
  }

  ctx.restore()

  // Debug label: product name next to hovered object (drawn in screen space, always upright)
  if (debugMode && hovered && !obj.grabbed) {
    const { x, y } = obj.body.position
    const label = obj.imageKey.replace(/\.(png|jpg|jpeg)$/i, '')
    const padding = { x: 8, y: 5 }
    ctx.save()
    ctx.globalAlpha = obj.alpha
    ctx.font = '12px system-ui, -apple-system, sans-serif'
    const tw = ctx.measureText(label).width
    const bx = x + 14
    const by = y - 10
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.beginPath()
    ctx.roundRect(bx - padding.x, by - 14, tw + padding.x * 2, 20, 5)
    ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.fillText(label, bx, by)
    ctx.restore()
  }
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number, maxLines: number) {
  const words = text.split(' ')
  let line = ''
  let lineCount = 0
  for (let n = 0; n < words.length; n++) {
    const test = line + words[n] + ' '
    if (ctx.measureText(test).width > maxW && n > 0) {
      ctx.fillText(line.trim(), x, y + lineCount * lineH)
      lineCount++
      if (lineCount >= maxLines) return
      line = words[n] + ' '
    } else {
      line = test
    }
  }
  if (lineCount < maxLines) ctx.fillText(line.trim(), x, y + lineCount * lineH)
}

function drawDescriptionCard(ctx: CanvasRenderingContext2D, obj: FloatingObject, info: ProductInfo) {
  const p = obj.cardProgress
  const ease = p * p * (3 - 2 * p)  // smoothstep

  const CARD_W = 270
  const CARD_H = info.howToUse ? 135 : 70
  const PAD_X = 14
  const GAP = obj.drawW / 2 + 18
  const T = -CARD_H / 2  // top edge in card space

  ctx.save()
  ctx.globalAlpha = obj.alpha * ease
  ctx.translate(obj.body.position.x + GAP, obj.body.position.y)
  ctx.rotate(-Math.PI / 2)
  ctx.translate((1 - ease) * 28, 0)

  // Card background
  ctx.fillStyle = 'rgba(8,8,8,0.72)'
  ctx.beginPath()
  ctx.roundRect(0, T, CARD_W, CARD_H, 9)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.1)'
  ctx.lineWidth = 1
  ctx.stroke()

  const maxTextW = CARD_W - PAD_X * 2

  // Product name — truncate with ellipsis if too wide
  ctx.fillStyle = 'rgba(255,255,255,0.95)'
  ctx.font = 'bold 13px system-ui,-apple-system,sans-serif'
  let name = info.name
  if (ctx.measureText(name).width > maxTextW) {
    while (name.length > 0 && ctx.measureText(name + '…').width > maxTextW) name = name.slice(0, -1)
    name += '…'
  }
  ctx.fillText(name, PAD_X, T + 20)

  // Description — 2 lines
  ctx.fillStyle = 'rgba(255,255,255,0.5)'
  ctx.font = '11px system-ui,-apple-system,sans-serif'
  wrapText(ctx, info.description, PAD_X, T + 36, maxTextW, 15, 2)

  // How to use section
  if (info.howToUse) {
    const divY = T + 70
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(PAD_X, divY)
    ctx.lineTo(CARD_W - PAD_X, divY)
    ctx.stroke()

    ctx.fillStyle = 'rgba(6,255,165,0.65)'
    ctx.font = 'bold 9px system-ui,-apple-system,sans-serif'
    ctx.fillText('HOW TO USE', PAD_X, divY + 13)

    ctx.fillStyle = 'rgba(255,255,255,0.45)'
    ctx.font = '11px system-ui,-apple-system,sans-serif'
    wrapText(ctx, info.howToUse, PAD_X, divY + 27, maxTextW, 15, 2)
  }

  ctx.restore()
}

function drawPoseSkeleton(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  W: number,
  H: number,
) {
  ctx.save()
  ctx.lineCap = 'round'

  // Pass 1: dim connections that don't push
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'
  ctx.lineWidth = 1.5
  ctx.shadowBlur = 0
  for (const [a, b] of POSE_CONNECTIONS) {
    if (PUSHING_CONNECTIONS.has(`${a},${b}`) || PUSHING_CONNECTIONS.has(`${b},${a}`)) continue
    const lmA = landmarks[a]
    const lmB = landmarks[b]
    if (!lmA || !lmB || (lmA.visibility ?? 1) < 0.25 || (lmB.visibility ?? 1) < 0.25) continue
    const [ax, ay] = lm2c(lmA, W, H)
    const [bx, by] = lm2c(lmB, W, H)
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(bx, by)
    ctx.stroke()
  }

  // Pass 2: pushing connections — single highlight color
  ctx.strokeStyle = '#4cc9f0'
  ctx.shadowColor = '#4cc9f0'
  ctx.lineWidth = 3
  ctx.shadowBlur = 12
  for (const [a, b] of POSE_CONNECTIONS) {
    if (!PUSHING_CONNECTIONS.has(`${a},${b}`) && !PUSHING_CONNECTIONS.has(`${b},${a}`)) continue
    const lmA = landmarks[a]
    const lmB = landmarks[b]
    if (!lmA || !lmB || (lmA.visibility ?? 1) < 0.25 || (lmB.visibility ?? 1) < 0.25) continue
    const [ax, ay] = lm2c(lmA, W, H)
    const [bx, by] = lm2c(lmB, W, H)
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(bx, by)
    ctx.stroke()
  }

  // Joints
  for (let i = 0; i < landmarks.length; i++) {
    const lm = landmarks[i]
    if ((lm.visibility ?? 1) < 0.25) continue
    const [x, y] = lm2c(lm, W, H)
    const pushing = PUSHING_JOINTS.has(i)
    ctx.beginPath()
    ctx.arc(x, y, pushing ? 6 : 3, 0, Math.PI * 2)
    ctx.shadowBlur = pushing ? 14 : 0
    ctx.shadowColor = '#4cc9f0'
    ctx.fillStyle = pushing ? '#4cc9f0' : 'rgba(255,255,255,0.3)'
    ctx.fill()
    ctx.shadowBlur = 0
  }

  // Intermediate limb colliders at 25/50/75% along each pushing segment
  ctx.strokeStyle = 'rgba(76,201,240,0.4)'
  ctx.lineWidth = 1.5
  ctx.shadowBlur = 0
  for (const [a, b] of LIMB_PAIRS) {
    const lmA = landmarks[a], lmB = landmarks[b]
    if (!lmA || !lmB || (lmA.visibility ?? 1) < 0.25 || (lmB.visibility ?? 1) < 0.25) continue
    const [ax, ay] = lm2c(lmA, W, H)
    const [bx, by] = lm2c(lmB, W, H)
    for (const t of LIMB_STEPS) {
      ctx.beginPath()
      ctx.arc(ax + (bx - ax) * t, ay + (by - ay) * t, COLLIDER_RADIUS, 0, Math.PI * 2)
      ctx.stroke()
    }
  }

  // Head collider — circle sized to 45% of shoulder width, matching physics
  const head = landmarks[0], lShoulder = landmarks[11], rShoulder = landmarks[12]
  if (head && (head.visibility ?? 1) >= 0.25 && lShoulder && rShoulder &&
      (lShoulder.visibility ?? 1) >= 0.25 && (rShoulder.visibility ?? 1) >= 0.25) {
    const [hx, hy] = lm2c(head, W, H)
    const [lsx, lsy] = lm2c(lShoulder, W, H)
    const [rsx, rsy] = lm2c(rShoulder, W, H)
    const shoulderDist = Math.hypot(lsx - rsx, lsy - rsy)
    const headR = shoulderDist * 0.28
    ctx.beginPath()
    ctx.arc(hx, hy - headR * 0.8, headR, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(76,201,240,0.5)'
    ctx.lineWidth = 2
    ctx.shadowBlur = 10
    ctx.shadowColor = '#4cc9f0'
    ctx.stroke()
    ctx.shadowBlur = 0
  }

  ctx.restore()
}

function drawHandOverlay(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  W: number,
  H: number,
  isFist: boolean,
  isGrabbing: boolean,
  debugMode: boolean,
) {
  if (debugMode) {
    const lineColor = isFist ? '#ffd60a' : 'rgba(255,255,255,0.7)'
    ctx.save()
    ctx.strokeStyle = lineColor
    ctx.lineWidth = 1.5
    ctx.shadowBlur = 6
    ctx.shadowColor = lineColor
    ctx.lineCap = 'round'

    for (const [a, b] of HAND_CONNECTIONS) {
      if (!landmarks[a] || !landmarks[b]) continue
      const [ax, ay] = lm2c(landmarks[a], W, H)
      const [bx, by] = lm2c(landmarks[b], W, H)
      ctx.beginPath()
      ctx.moveTo(ax, ay)
      ctx.lineTo(bx, by)
      ctx.stroke()
    }

    ctx.shadowBlur = 0
    for (const i of [4, 8, 12, 16, 20]) {
      if (!landmarks[i]) continue
      const [x, y] = lm2c(landmarks[i], W, H)
      ctx.beginPath()
      ctx.arc(x, y, 5, 0, Math.PI * 2)
      ctx.fillStyle = isFist ? '#ffd60a' : '#ff6b6b'
      ctx.fill()
    }
    ctx.restore()
  }

  // Grab indicator centered on palm
  const palm = getPalmCenter(landmarks)
  const px = (1 - palm.x) * W
  const py = palm.y * H

  // Reach radius: wrist → palm center (same calc as main.ts)
  const wrist = landmarks[0]
  const wx = (1 - wrist.x) * W
  const wy = wrist.y * H
  const reach = Math.hypot(wx - px, wy - py)

  if (isFist || isGrabbing) {
    const color = isGrabbing ? '#06ffa5' : '#ffd60a'
    const r = isGrabbing ? 22 : 16

    ctx.save()
    // Reach zone ring — brighter when fist closed
    ctx.beginPath()
    ctx.arc(px, py, reach, 0, Math.PI * 2)
    ctx.setLineDash([5, 7])
    ctx.strokeStyle = isGrabbing ? 'rgba(6,255,165,0.35)' : 'rgba(255,214,10,0.35)'
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.setLineDash([])
    // Centre dot + inner ring
    ctx.beginPath()
    ctx.arc(px, py, r, 0, Math.PI * 2)
    ctx.strokeStyle = color
    ctx.lineWidth = 3
    ctx.shadowBlur = 18
    ctx.shadowColor = color
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(px, py, 5, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.shadowBlur = 0
    ctx.fill()
    ctx.restore()
  } else {
    ctx.save()
    // Reach zone ring — always visible so user knows their interaction area
    ctx.beginPath()
    ctx.arc(px, py, reach, 0, Math.PI * 2)
    ctx.setLineDash([5, 7])
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.setLineDash([])
    // Small centre dot
    ctx.beginPath()
    ctx.arc(px, py, 5, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.restore()
  }
}
