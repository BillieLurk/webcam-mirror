import type { NormalizedLandmark } from './tracker'
import type { FloatingObject } from './physics'
import type { ImageInfo, ProductInfo } from './assets'
import type { AlphaMask } from './segmenter'
import { detectFist, getPalmCenter } from './tracker'

// Only `.landmarks` is read here — a plain shape (rather than the full class-typed
// PoseLandmarkerResult/HandLandmarkerResult) so callers can pass smoothed/synthetic
// landmark data without needing to fake methods like `.close()`.
type PoseLike = { landmarks: NormalizedLandmark[][] }
type HandsLike = { landmarks: NormalizedLandmark[][] }

// Offscreen canvases for background compositing, lazily created
let maskCanvas: OffscreenCanvas | null = null
let maskCtx: OffscreenCanvasRenderingContext2D | null = null
let personCanvas: OffscreenCanvas | null = null
let personCtx: OffscreenCanvasRenderingContext2D | null = null

/**
 * Composite the person (from RVM alpha) over a solid background colour.
 * Uses OffscreenCanvas compositing (GPU) instead of per-pixel JS loops.
 */
function drawBackground(ctx: CanvasRenderingContext2D, bgColor: string, bgImage: HTMLImageElement | null, W: number, H: number) {
  if (bgImage && bgImage.complete && bgImage.naturalWidth > 0) {
    const iW = bgImage.naturalWidth
    const iH = bgImage.naturalHeight
    // Cover-fit: scale to fill the canvas without distortion
    const scale = Math.max(W / iW, H / iH)
    const dw = iW * scale
    const dh = iH * scale
    ctx.drawImage(bgImage, (W - dw) / 2, (H - dh) / 2, dw, dh)
  } else {
    ctx.fillStyle = bgColor
    ctx.fillRect(0, 0, W, H)
  }
}

function drawWithSegmentation(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement | HTMLCanvasElement,
  seg: AlphaMask,
  bgColor: string,
  bgImage: HTMLImageElement | null,
  W: number,
  H: number,
  flipV: boolean,
  flipH: boolean,
  portraitCam: boolean,
) {
  const { data: alphaData, width: mW, height: mH } = seg

  // Build alpha mask ImageData at RVM resolution
  if (!maskCanvas || maskCanvas.width !== mW || maskCanvas.height !== mH) {
    maskCanvas = new OffscreenCanvas(mW, mH)
    maskCtx = maskCanvas.getContext('2d')!
  }
  const maskImg = maskCtx!.createImageData(mW, mH)
  const mp = maskImg.data
  for (let i = 0; i < mW * mH; i++) {
    mp[i * 4 + 3] = Math.round(Math.max(0, Math.min(1, alphaData[i])) * 255)
  }
  maskCtx!.putImageData(maskImg, 0, 0)

  // Draw mirrored video onto personCanvas, then cut out background via mask
  if (!personCanvas || personCanvas.width !== W || personCanvas.height !== H) {
    personCanvas = new OffscreenCanvas(W, H)
    personCtx = personCanvas.getContext('2d')!
  }
  personCtx!.clearRect(0, 0, W, H)
  personCtx!.save()
  if (portraitCam) {
    // Portrait: rotate video -90° (cover-fit) so portrait content fills landscape canvas.
    // Both video and mask get the same transform → they stay aligned.
    const vW = video instanceof HTMLVideoElement ? video.videoWidth : video.width
    const vH = video instanceof HTMLVideoElement ? video.videoHeight : video.height
    const s = Math.max(W / vH, H / vW)
    const dw = vW * s, dh = vH * s
    personCtx!.translate(W / 2, H / 2)
    personCtx!.rotate(-Math.PI / 2)
    // In rotated local space: X→visual-down, Y→visual-right, so swap flip axes
    personCtx!.scale(flipV ? -1 : 1, flipH ? -1 : 1)
    personCtx!.drawImage(video, -dw / 2, -dh / 2, dw, dh)
    personCtx!.globalCompositeOperation = 'destination-in'
    personCtx!.filter = 'blur(2px)'
    personCtx!.drawImage(maskCanvas, -dw / 2, -dh / 2, dw, dh)
    personCtx!.filter = 'none'
  } else {
    personCtx!.translate(flipH ? W : 0, flipV ? H : 0)
    personCtx!.scale(flipH ? -1 : 1, flipV ? -1 : 1)
    personCtx!.drawImage(video, 0, 0, W, H)
    personCtx!.globalCompositeOperation = 'destination-in'
    personCtx!.filter = 'blur(2px)'
    personCtx!.drawImage(maskCanvas, 0, 0, W, H)
    personCtx!.filter = 'none'
  }
  personCtx!.restore()
  personCtx!.globalCompositeOperation = 'source-over'

  // Background + masked person on top
  drawBackground(ctx, bgColor, bgImage, W, H)
  ctx.drawImage(personCanvas, 0, 0)
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

/** Convert normalized MediaPipe landmark to canvas coordinates, respecting flip state. */
function lm2c(lm: NormalizedLandmark, W: number, H: number, flipV = false, flipH = true): [number, number] {
  return [(flipH ? 1 - lm.x : lm.x) * W, (flipV ? 1 - lm.y : lm.y) * H]
}

// Fixed screensaver orb positions & properties (stable across frames)
const ORBS = [
  { nx: 0.22, ny: 0.38, nr: 0.28, color: [76, 201, 240],  sx: 0.7, sy: 0.5,  phase: 0.0 },
  { nx: 0.78, ny: 0.62, nr: 0.24, color: [6, 255, 165],   sx: 0.5, sy: 0.7,  phase: 2.1 },
  { nx: 0.50, ny: 0.25, nr: 0.20, color: [123, 94, 167],  sx: 0.6, sy: 0.45, phase: 4.2 },
  { nx: 0.15, ny: 0.72, nr: 0.18, color: [255, 100, 130], sx: 0.4, sy: 0.6,  phase: 1.0 },
  { nx: 0.85, ny: 0.28, nr: 0.16, color: [255, 200, 50],  sx: 0.55, sy: 0.5, phase: 3.3 },
]

function drawScreensaver(ctx: CanvasRenderingContext2D, alpha: number, t: number, W: number, H: number) {
  if (alpha <= 0.005) return
  const ms = t  // requestAnimationFrame timestamp in ms

  ctx.save()
  ctx.globalAlpha = alpha

  // Dark vignette base
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.fillRect(0, 0, W, H)

  // Softly drifting glow orbs
  ctx.globalCompositeOperation = 'lighter'
  for (const o of ORBS) {
    const x = (o.nx + Math.sin(ms * 0.0003 * o.sx + o.phase) * 0.09) * W
    const y = (o.ny + Math.cos(ms * 0.0002 * o.sy + o.phase) * 0.07) * H
    const r = o.nr * Math.min(W, H)
    const [r0, g0, b0] = o.color
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r)
    grad.addColorStop(0, `rgba(${r0},${g0},${b0},0.18)`)
    grad.addColorStop(1, `rgba(${r0},${g0},${b0},0)`)
    ctx.fillStyle = grad
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }
  ctx.globalCompositeOperation = 'source-over'

  // Pulsing hint text
  const textPulse = 0.55 + Math.sin(ms * 0.0015) * 0.25
  ctx.globalAlpha = alpha * textPulse
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  ctx.font = '500 16px system-ui,-apple-system,sans-serif'
  ctx.textAlign = 'center'
  ctx.letterSpacing = '0.12em'
  ctx.fillText('STEP IN FRONT OF THE CAMERA', W / 2, H / 2)
  ctx.letterSpacing = '0'

  ctx.restore()
}

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement | HTMLCanvasElement,
  objects: FloatingObject[],
  poseResult: PoseLike | null,
  handResult: HandsLike | null,
  debugMode: boolean,
  grabbing: Map<number, boolean>,
  hoverObjects: Set<FloatingObject>,
  images: Map<string, ImageInfo>,
  segmentation: AlphaMask | null,
  bgColor: string,
  bgImage: HTMLImageElement | null,
  bgEnabled: boolean,
  screensaverAlpha: number,
  timestamp: number,
  productInfo: Record<string, ProductInfo>,
  flipV: boolean,
  flipH: boolean,
  portraitCam: boolean,
) {
  const { width: W, height: H } = ctx.canvas

  ctx.clearRect(0, 0, W, H)

  if (bgEnabled && segmentation) {
    drawWithSegmentation(ctx, video, segmentation, bgColor, bgImage, W, H, flipV, flipH, portraitCam)
  } else {
    ctx.save()
    if (portraitCam) {
      const vW = video instanceof HTMLVideoElement ? video.videoWidth : video.width
      const vH = video instanceof HTMLVideoElement ? video.videoHeight : video.height
      const s = Math.max(W / vH, H / vW)
      const dw = vW * s, dh = vH * s
      ctx.translate(W / 2, H / 2)
      ctx.rotate(-Math.PI / 2)
      ctx.scale(flipV ? -1 : 1, flipH ? -1 : 1)
      ctx.drawImage(video, -dw / 2, -dh / 2, dw, dh)
    } else {
      ctx.translate(flipH ? W : 0, flipV ? H : 0)
      ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1)
      ctx.drawImage(video, 0, 0, W, H)
    }
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
    drawPoseSkeleton(ctx, poseResult.landmarks[0], W, H, flipV, flipH)
  }

  // Hand overlays (always show grab/pinch feedback)
  if (handResult) {
    for (let i = 0; i < handResult.landmarks.length; i++) {
      const lms = handResult.landmarks[i]
      const pinching = detectFist(lms)
      const isGrabbing = grabbing.get(i) ?? false
      drawHandOverlay(ctx, lms, W, H, pinching, isGrabbing, debugMode, flipV, flipH)
    }
  }

  // Screensaver overlay — on top of everything
  drawScreensaver(ctx, screensaverAlpha, timestamp, W, H)
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
  flipV = false,
  flipH = true,
) {
  const c = (lm: NormalizedLandmark) => lm2c(lm, W, H, flipV, flipH)

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
    const [ax, ay] = c(lmA)
    const [bx, by] = c(lmB)
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
    const [ax, ay] = c(lmA)
    const [bx, by] = c(lmB)
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(bx, by)
    ctx.stroke()
  }

  // Joints
  for (let i = 0; i < landmarks.length; i++) {
    const lm = landmarks[i]
    if ((lm.visibility ?? 1) < 0.25) continue
    const [x, y] = c(lm)
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
    const [ax, ay] = c(lmA)
    const [bx, by] = c(lmB)
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
    const [hx, hy] = c(head)
    const [lsx, lsy] = c(lShoulder)
    const [rsx, rsy] = c(rShoulder)
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
  flipV = false,
  flipH = true,
) {
  const c = (lm: NormalizedLandmark) => lm2c(lm, W, H, flipV, flipH)
  const toX = (x: number) => (flipH ? 1 - x : x) * W
  const toY = (y: number) => (flipV ? 1 - y : y) * H

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
      const [ax, ay] = c(landmarks[a])
      const [bx, by] = c(landmarks[b])
      ctx.beginPath()
      ctx.moveTo(ax, ay)
      ctx.lineTo(bx, by)
      ctx.stroke()
    }

    ctx.shadowBlur = 0
    for (const i of [4, 8, 12, 16, 20]) {
      if (!landmarks[i]) continue
      const [x, y] = c(landmarks[i])
      ctx.beginPath()
      ctx.arc(x, y, 5, 0, Math.PI * 2)
      ctx.fillStyle = isFist ? '#ffd60a' : '#ff6b6b'
      ctx.fill()
    }
    ctx.restore()
  }

  // Grab indicator centered on palm
  const palm = getPalmCenter(landmarks)
  const px = toX(palm.x)
  const py = toY(palm.y)

  // Reach radius: wrist → palm center (same calc as main.ts)
  const wrist = landmarks[0]
  const wx = toX(wrist.x)
  const wy = toY(wrist.y)
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
