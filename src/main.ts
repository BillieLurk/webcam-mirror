import { Tracker, detectFist, getPalmCenter } from './tracker'
import { PhysicsScene } from './physics'
import { renderFrame, getDepthCoverageRect } from './renderer'
import { DepthReceiver } from './depth-receiver'
import { PRODUCT_FILES, preloadImages, getCategoryScale, SCALE_CONFIG, PRODUCT_INFO } from './assets'
import type { DepthFrame } from './depth-receiver'
import type { PoseLandmarkerResult, HandLandmarkerResult } from './tracker'

const BODY_INDICES = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]
const BODY_RADIUS = 26

// Limb segment pairs: each gets a midpoint collision body so the full limb pushes objects
// Pose indices: 11/12=shoulders, 13/14=elbows, 15/16=wrists, 23/24=hips, 25/26=knees, 27/28=ankles
const LIMB_PAIRS: [number, number][] = [
  [0, 11], [0, 12],   // neck: nose → shoulders
  [11, 12],           // shoulder bar
  [11, 13],           // left upper arm
  [13, 15],           // left forearm (elbow → wrist)
  [12, 14],           // right upper arm
  [14, 16],           // right forearm (elbow → wrist)
  [11, 23], [12, 24], // torso sides
  [23, 24],           // hip bar
  [23, 25], [25, 27], // left thigh, left shin
  [24, 26], [26, 28], // right thigh, right shin
]


async function main() {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement
  const ctx = canvas.getContext('2d')!
  const statusEl = document.getElementById('status') as HTMLDivElement
  const loadingEl = document.getElementById('loading') as HTMLDivElement
  const loadingMsg = document.getElementById('loading-msg') as HTMLDivElement
  const debugBtn = document.getElementById('debugBtn') as HTMLButtonElement
  const addBtn = document.getElementById('addBtn') as HTMLButtonElement
  const clearBtn = document.getElementById('clearBtn') as HTMLButtonElement
  const bgPicker = document.getElementById('bgPicker') as HTMLInputElement
  const depthBtn = document.getElementById('depthBtn') as HTMLButtonElement
  const depthIPInput = document.getElementById('depthIP') as HTMLInputElement
  const hintEl = document.getElementById('hint') as HTMLDivElement

  let debugMode = false
  let bgColor = '#00ff88'
  let lastPose: PoseLandmarkerResult | null = null
  let lastHands: HandLandmarkerResult | null = null
  let lastDepthFrame: DepthFrame | null = null
  let depthThreshold = 2.5
  let prevTimestamp = 0

  // Depth camera receiver
  const depthReceiver = new DepthReceiver()
  let depthFrameDirty = false
  let userDisconnectedDepth = false // explicit click, not a dropped connection — don't fight the user's own choice
  let depthReconnectTimer: ReturnType<typeof setTimeout> | null = null
  depthReceiver.onFrame = (frame) => {
    // Each frame decodes a fresh ImageBitmap (GPU-backed) — close the previous
    // one or they pile up faster than GC reclaims them and the tab grinds to a halt.
    lastDepthFrame?.colorBitmap.close()
    lastDepthFrame = frame
    depthFrameDirty = true
  }
  depthReceiver.onStatusChange = (connected) => {
    depthBtn.classList.toggle('active', connected)
    depthBtn.textContent = connected ? 'Depth: Connected' : 'Connect Depth Camera'
    // Both onerror and onclose fire on a failed connection attempt — only
    // ever have one reconnect timer pending at a time.
    if (!connected && !userDisconnectedDepth && depthReconnectTimer === null) {
      // Dropped unexpectedly (relay/sender restart, camera unplugged, etc.) —
      // this runs unattended as a store display, so keep retrying rather than
      // waiting for someone to notice and click the button again.
      depthReconnectTimer = setTimeout(() => {
        depthReconnectTimer = null
        connectDepth()
      }, 3000)
    }
  }

  function connectDepth() {
    const ip = depthIPInput.value.trim()
    if (!ip) return
    userDisconnectedDepth = false
    depthReceiver.connect(`ws://${ip}:8080/view`)
  }
  connectDepth()

  // Camera
  statusEl.textContent = 'Requesting camera...'
  const video = document.createElement('video')
  video.autoplay = true
  video.playsInline = true
  video.muted = true
  let hasWebcam = false

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: false,
    })
    video.srcObject = stream
    await new Promise<void>((res) => { video.onloadedmetadata = () => res() })
    await video.play()
    hasWebcam = true
  } catch {
    // No local webcam (or it's claimed elsewhere, e.g. by the depth camera's own
    // sender process) — carry on and rely on the depth camera's own color feed
    // for both tracking and the mirror image once it's connected.
    statusEl.textContent = 'No local camera — connect a depth camera from the settings menu'
  }

  // Physics
  const physics = new PhysicsScene(window.innerWidth, window.innerHeight)

  function resize() {
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight
    physics.resize(canvas.width, canvas.height)
  }
  resize()
  window.addEventListener('resize', resize)

  // Preload product images and spawn one of each
  const images = await preloadImages()

  const TARGET_SIZE = 150 // target px for the largest content dimension

  function computeDrawParams(key: string) {
    const info = images.get(key)
    if (!info) return { bodyW: TARGET_SIZE, bodyH: TARGET_SIZE, drawW: TARGET_SIZE, drawH: TARGET_SIZE, drawX: -TARGET_SIZE / 2, drawY: -TARGET_SIZE / 2 }
    const { el, contentX, contentY, contentW, contentH } = info
    const imgW = el.naturalWidth, imgH = el.naturalHeight
    const contentPxW = contentW * imgW
    const contentPxH = contentH * imgH
    const scale = (TARGET_SIZE * getCategoryScale(key)) / Math.max(contentPxW, contentPxH)
    const drawW = imgW * scale
    const drawH = imgH * scale
    const bodyW = contentPxW * scale
    const bodyH = contentPxH * scale
    // Offset image so its content center lands at local (0,0)
    const ccx = contentX + contentW / 2
    const ccy = contentY + contentH / 2
    const drawX = -ccx * drawW
    const drawY = -ccy * drawH
    return { bodyW, bodyH, drawW, drawH, drawX, drawY }
  }

  let MAX_OBJECTS = 5

  function spawnNext() {
    const key = PRODUCT_FILES[Math.floor(Math.random() * PRODUCT_FILES.length)]
    const { bodyW, bodyH, drawW, drawH, drawX, drawY } = computeDrawParams(key)
    physics.spawnObject(key, bodyW, bodyH, drawW, drawH, drawX, drawY)
  }
  for (let i = 0; i < MAX_OBJECTS; i++) spawnNext()

  // MediaPipe
  const tracker = new Tracker()
  try {
    await tracker.init((msg) => { loadingMsg.textContent = msg })
  } catch (err) {
    loadingMsg.textContent = `Model load failed: ${(err as Error).message}`
    return
  }

  loadingEl.style.display = 'none'
  statusEl.textContent = hasWebcam ? 'Tracking active' : 'No local camera — connect a depth camera from the settings menu'

  // Fade out hint after 8s
  setTimeout(() => {
    hintEl.style.transition = 'opacity 1.5s'
    hintEl.style.opacity = '0'
  }, 8000)

  // UI — menu hidden by default, toggled via the settings button
  const uiEl = document.getElementById('ui') as HTMLDivElement
  const menuBtn = document.getElementById('menuBtn') as HTMLButtonElement
  let menuOpen = false
  menuBtn.addEventListener('click', () => {
    menuOpen = !menuOpen
    uiEl.style.display = menuOpen ? 'flex' : 'none'
    menuBtn.classList.toggle('active', menuOpen)
  })

  debugBtn.addEventListener('click', () => {
    debugMode = !debugMode
    debugBtn.classList.toggle('active', debugMode)
  })
  addBtn.addEventListener('click', () => {
    const toAdd = MAX_OBJECTS - physics.floatingObjects.length
    for (let i = 0; i < toAdd; i++) spawnNext()
  })
  clearBtn.addEventListener('click', () => physics.clearObjects())
  bgPicker.addEventListener('input', () => { bgColor = bgPicker.value })
  depthBtn.addEventListener('click', () => {
    if (depthReceiver.connected) {
      userDisconnectedDepth = true
      depthReceiver.disconnect()
      lastDepthFrame = null
    } else if (!depthIPInput.value.trim()) {
      depthIPInput.focus()
    } else {
      connectDepth()
    }
  })

  // --- Tuning panel: category size sliders + max objects ---
  const tuningPanel = document.getElementById('tuningPanel') as HTMLDivElement
  const exportBtn = document.getElementById('exportBtn') as HTMLButtonElement

  function makeSliderRow(label: string, value: number, min: number, max: number, step: number, onChange: (v: number) => void) {
    const row = document.createElement('div')
    row.className = 'tuning-row'
    const lbl = document.createElement('label')
    lbl.textContent = label
    const slider = document.createElement('input')
    slider.type = 'range'
    slider.min = String(min)
    slider.max = String(max)
    slider.step = String(step)
    slider.value = String(value)
    const val = document.createElement('span')
    val.className = 'tuning-val'
    val.textContent = value.toFixed(2)
    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value)
      val.textContent = v.toFixed(2)
      onChange(v)
    })
    row.append(lbl, slider, val)
    return row
  }

  // Depth threshold slider
  const depthSection = document.createElement('div')
  depthSection.className = 'tuning-section-label'
  depthSection.textContent = 'Depth Camera'
  tuningPanel.append(depthSection)
  tuningPanel.append(makeSliderRow('BG cut (m)', depthThreshold, 0.5, 6.0, 0.1, v => { depthThreshold = v }))

  // Max objects slider
  const maxObjSection = document.createElement('div')
  maxObjSection.className = 'tuning-section-label'
  maxObjSection.textContent = 'Max Objects'
  tuningPanel.append(maxObjSection)
  tuningPanel.append(makeSliderRow('Count', MAX_OBJECTS, 1, 20, 1, v => { MAX_OBJECTS = v }))

  // Category scale sliders
  const sizeSection = document.createElement('div')
  sizeSection.className = 'tuning-section-label'
  sizeSection.textContent = 'Category Sizes'
  tuningPanel.append(sizeSection)
  for (const cat of Object.keys(SCALE_CONFIG)) {
    tuningPanel.append(makeSliderRow(cat, SCALE_CONFIG[cat], 0.3, 3.0, 0.05, v => { SCALE_CONFIG[cat] = v }))
  }

  exportBtn.addEventListener('click', () => {
    const config = { maxObjects: MAX_OBJECTS, scales: { ...SCALE_CONFIG } }
    const json = JSON.stringify(config, null, 2)
    navigator.clipboard.writeText(json).then(() => {
      exportBtn.textContent = 'Copied!'
      setTimeout(() => { exportBtn.textContent = 'Export Config' }, 1800)
    })
  })

  // Per-hand pinch tracking
  const pinchWas = new Map<number, boolean>()

  // Reuse these each frame to avoid per-frame allocations
  const grabbing = new Map<number, boolean>()
  const hoverObjects = new Set<import('./physics').FloatingObject>()

  // Downscaled copy of the depth camera's color frame fed to MediaPipe — pose/hand
  // landmark accuracy doesn't need full 1280x720, and cutting the pixel count this
  // much (~5x) cuts model inference cost by roughly the same factor.
  const trackCanvas = document.createElement('canvas')
  trackCanvas.width = 640
  trackCanvas.height = 360
  const trackCtx = trackCanvas.getContext('2d')!

  function loop(ts: number) {
    const dt = Math.min(ts - prevTimestamp, 50)
    prevTimestamp = ts

    // --- Tracking ---
    // Prefer the depth camera's own color feed (it's the only camera on machines
    // where a separate webcam isn't available / is claimed by the depth sender);
    // fall back to a local webcam if one was granted. The depth feed only updates
    // ~20-25fps over the WebSocket while rAF runs ~60fps — re-running pose/hand
    // detection on the same still bitmap between arrivals is pure wasted GPU work
    // that compounds frame over frame, so skip detection until a fresh frame has
    // actually arrived (a real <video> element paces itself, no flag needed).
    const usingDepthSource = lastDepthFrame !== null
    let trackingSource: TexImageSource | null = null
    if (usingDepthSource) {
      // Crop identically to what's actually displayed (see drawWithDepth in
      // renderer.ts) — otherwise landmarks are computed against the full
      // frame while the video they're overlaid on is a zoomed-in crop of it,
      // throwing the skeleton off by however much the crop offsets things.
      const cov = getDepthCoverageRect()
      if (cov) {
        trackCtx.drawImage(
          lastDepthFrame!.colorBitmap,
          cov.x0, cov.y0, cov.x1 - cov.x0, cov.y1 - cov.y0,
          0, 0, trackCanvas.width, trackCanvas.height,
        )
      } else {
        // First frame or two, before drawWithDepth has detected the coverage
        // rect yet — use the uncropped frame rather than block on it.
        trackCtx.drawImage(lastDepthFrame!.colorBitmap, 0, 0, trackCanvas.width, trackCanvas.height)
      }
      trackingSource = trackCanvas
    } else if (hasWebcam) {
      trackingSource = video
    }
    const shouldDetect = trackingSource && (!usingDepthSource || depthFrameDirty)
    if (usingDepthSource) depthFrameDirty = false
    const result = shouldDetect ? tracker.detect(trackingSource!, ts) : null
    if (result) {
      lastPose = result.pose
      lastHands = result.hands
    }

    // --- Pose → physics bodies ---
    if (lastPose && lastPose.landmarks.length > 0) {
      const lms = lastPose.landmarks[0]

      // Compute shoulder width in screen space — used as distance proxy for head radius.
      // Wider shoulders = closer to camera = bigger head collider.
      const ls = lms[11], rs = lms[12]
      const shoulderPxDist = (ls && rs && (ls.visibility ?? 1) >= 0.3 && (rs.visibility ?? 1) >= 0.3)
        ? Math.hypot((1 - ls.x) * canvas.width - (1 - rs.x) * canvas.width, ls.y * canvas.height - rs.y * canvas.height)
        : 0
      // Head radius ≈ 28% of shoulder width; min = BODY_RADIUS
      const HEAD_RADIUS = shoulderPxDist > 0 ? Math.max(BODY_RADIUS, shoulderPxDist * 0.28) : BODY_RADIUS

      // Joint endpoint bodies
      // Wrist bodies (15=left, 16=right) are placed at 70% from elbow→wrist so
      // the collider stops short of the actual wrist joint.
      const WRIST_ELBOW: Record<number, number> = { 15: 13, 16: 14 }
      for (const idx of BODY_INDICES) {
        const lm = lms[idx]
        if (!lm || (lm.visibility ?? 1) < 0.3) {
          physics.parkLandmark(`p${idx}`)
          continue
        }
        let cx = (1 - lm.x) * canvas.width
        let cy = lm.y * canvas.height
        const elbowIdx = WRIST_ELBOW[idx]
        if (elbowIdx !== undefined) {
          const elbow = lms[elbowIdx]
          if (elbow && (elbow.visibility ?? 1) >= 0.3) {
            const ex = (1 - elbow.x) * canvas.width
            const ey = elbow.y * canvas.height
            cx = ex + (cx - ex) * 0.7
            cy = ey + (cy - ey) * 0.7
          }
        }
        const radius = idx === 0 ? HEAD_RADIUS : BODY_RADIUS
        // Shift head collider up from nose so it centers on the skull
        const finalCy = idx === 0 ? cy - HEAD_RADIUS * 0.8 : cy
        physics.updateLandmark(`p${idx}`, cx, finalCy, radius)
      }

      // Bodies evenly spaced along each limb — 3 per segment fills the gaps between joints
      const STEPS = [0.25, 0.5, 0.75]
      for (const [a, b] of LIMB_PAIRS) {
        const lmA = lms[a]
        const lmB = lms[b]
        if (!lmA || !lmB || (lmA.visibility ?? 1) < 0.3 || (lmB.visibility ?? 1) < 0.3) {
          for (let s = 0; s < STEPS.length; s++) physics.parkLandmark(`mid_${a}_${b}_${s}`)
          continue
        }
        const ax = (1 - lmA.x) * canvas.width,  ay = lmA.y * canvas.height
        const bx = (1 - lmB.x) * canvas.width,  by = lmB.y * canvas.height
        for (let s = 0; s < STEPS.length; s++) {
          const t = STEPS[s]
          physics.updateLandmark(`mid_${a}_${b}_${s}`, ax + (bx - ax) * t, ay + (by - ay) * t, BODY_RADIUS)
        }
      }
    } else {
      for (const idx of BODY_INDICES) physics.parkLandmark(`p${idx}`)
      for (const [a, b] of LIMB_PAIRS) {
        for (let s = 0; s < 3; s++) physics.parkLandmark(`mid_${a}_${b}_${s}`)
      }
    }

    // --- Hands → physics bodies + grab logic ---
    if (lastHands) {
      const count = lastHands.landmarks.length

      // Release grabs for disappeared hands (no position — throw with zero velocity)
      for (const [i] of pinchWas) {
        if (i >= count) {
          physics.releaseGrab(i)
          pinchWas.delete(i)
        }
      }

      for (let i = 0; i < count; i++) {
        const lms = lastHands.landmarks[i]

        const pinching = detectFist(lms)
        const wasPinching = pinchWas.get(i) ?? false

        // Palm center in canvas coords (mirrored)
        const palm = getPalmCenter(lms)
        const px = (1 - palm.x) * canvas.width
        const py = palm.y * canvas.height

        // Grab radius = wrist to palm center distance (palm length, not full finger reach)
        const wrist = lms[0]
        const wristX = (1 - wrist.x) * canvas.width
        const wristY = wrist.y * canvas.height
        const handReach = Math.hypot(wristX - px, wristY - py)

        // Hand rotation angle: direction from wrist to middle knuckle in mirrored space
        const midMcp = lms[9]
        const handAngle = Math.atan2(midMcp.y - wrist.y, wrist.x - midMcp.x)

        if (pinching && !wasPinching) {
          physics.tryGrab(i, px, py, handReach, handAngle)
        } else if (pinching && wasPinching) {
          physics.moveGrab(i, px, py, handAngle)
        } else if (!pinching && wasPinching) {
          physics.releaseGrab(i)
        }

        pinchWas.set(i, pinching)
      }
    }

    // Build grab map and hover set for renderer (reuse pre-allocated collections)
    grabbing.clear()
    hoverObjects.clear()
    if (lastHands) {
      for (let i = 0; i < lastHands.landmarks.length; i++) {
        grabbing.set(i, physics.isGrabbing(i))
        if (!physics.isGrabbing(i)) {
          const lms = lastHands.landmarks[i]
          const palm = getPalmCenter(lms)
          const px = (1 - palm.x) * canvas.width
          const py = palm.y * canvas.height
          const wrist = lms[0]
          const wristX = (1 - wrist.x) * canvas.width
          const wristY = wrist.y * canvas.height
          const handReach = Math.hypot(wristX - px, wristY - py)
          const hovered = physics.getHoverObject(i, px, py, handReach * 1.8)
          if (hovered) hoverObjects.add(hovered)
        }
      }
    }

    // --- Step physics ---
    physics.step(dt)

    // --- Lifecycle: remove dead objects, maintain MAX_OBJECTS ---
    physics.collectDeadObjects()
    while (physics.floatingObjects.length < MAX_OBJECTS) spawnNext()

    // --- Body depenetration (after step so collision resolution can't undo it) ---
    if (lastPose && lastPose.landmarks.length > 0) {
      const lms = lastPose.landmarks[0]
      const nose = lms[0], s11 = lms[11], s12 = lms[12], h23 = lms[23], h24 = lms[24]

      // Torso quad: shoulders + hips
      if (s11 && s12 && h23 && h24 &&
          (s11.visibility ?? 1) >= 0.3 && (s12.visibility ?? 1) >= 0.3 &&
          (h23.visibility ?? 1) >= 0.3 && (h24.visibility ?? 1) >= 0.3) {
        physics.pushFromTorso([
          { x: (1 - s11.x) * canvas.width, y: s11.y * canvas.height },
          { x: (1 - s12.x) * canvas.width, y: s12.y * canvas.height },
          { x: (1 - h24.x) * canvas.width, y: h24.y * canvas.height },
          { x: (1 - h23.x) * canvas.width, y: h23.y * canvas.height },
        ])
      }

      // Neck/head triangle: nose + shoulders
      if (nose && s11 && s12 &&
          (nose.visibility ?? 1) >= 0.3 && (s11.visibility ?? 1) >= 0.3 && (s12.visibility ?? 1) >= 0.3) {
        physics.pushFromTorso([
          { x: (1 - nose.x) * canvas.width, y: nose.y * canvas.height },
          { x: (1 - s11.x) * canvas.width,  y: s11.y * canvas.height },
          { x: (1 - s12.x) * canvas.width,  y: s12.y * canvas.height },
        ])
      }
    }

    // --- Render ---
    renderFrame(ctx, video, physics.floatingObjects, lastPose, lastHands, debugMode, grabbing, hoverObjects, images, bgColor, lastDepthFrame, depthThreshold, PRODUCT_INFO)

    requestAnimationFrame(loop)
  }

  requestAnimationFrame(loop)
}

main().catch(console.error)
