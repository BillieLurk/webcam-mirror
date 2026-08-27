import { Tracker, detectFist, getPalmCenter } from './tracker'
import screensaverSlides from 'virtual:screensavers'
import { RVMSegmenter } from './segmenter'
import { PhysicsScene } from './physics'
import { renderFrame } from './renderer'
import { PRODUCT_FILES, preloadImages, getCategoryScale, SCALE_CONFIG, PRODUCT_INFO } from './assets'
import type { PoseLandmarkerResult, HandLandmarkerResult } from './tracker'
import type { AlphaMask } from './segmenter'

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
  const portraitCamBtn = document.getElementById('portraitCamBtn') as HTMLButtonElement
  const flipVBtn = document.getElementById('flipVBtn') as HTMLButtonElement
  const flipHBtn = document.getElementById('flipHBtn') as HTMLButtonElement
  const screensaverBtn = document.getElementById('screensaverBtn') as HTMLButtonElement
  const addBtn = document.getElementById('addBtn') as HTMLButtonElement
  const clearBtn = document.getElementById('clearBtn') as HTMLButtonElement
  const bgBtn = document.getElementById('bgBtn') as HTMLButtonElement
  const bgPicker = document.getElementById('bgPicker') as HTMLInputElement
  const hintEl = document.getElementById('hint') as HTMLDivElement

  // --- Persist settings in localStorage ---
  const LS = {
    get: (k: string) => localStorage.getItem('dm_' + k),
    set: (k: string, v: string) => localStorage.setItem('dm_' + k, v),
    del: (k: string) => localStorage.removeItem('dm_' + k),
  }

  let debugMode = LS.get('debugMode') === '1'
  let bgEnabled = LS.get('bgEnabled') !== '0'  // default on
  let portraitCam = LS.get('portraitCam') === '1'
  let flipV = LS.get('flipV') === '1'
  let flipH = LS.get('flipH') !== '0'  // default on (mirror mode)
  let screensaverEnabled = LS.get('screensaverEnabled') !== '0'
  let bgColor = LS.get('bgColor') ?? '#00ff88'
  let bgImage: HTMLImageElement | null = null
  let lastPose: PoseLandmarkerResult | null = null
  let lastHands: HandLandmarkerResult | null = null
  let lastSeg: AlphaMask | null = null
  let prevTimestamp = 0
  let segmentPending = false
  let personAbsentMs = 0
  let screensaverAlpha = 0
  let frameCount = 0

  // Restore saved background image, or fall back to the default studio background
  const savedImg = LS.get('bgImage')
  const img = new Image()
  img.src = savedImg ?? '/assets/default-bg.jpg'
  img.onload = () => { bgImage = img }

  // Screensaver — single static image
  const screensaverOverlay = document.getElementById('screensaverOverlay') as HTMLDivElement
  const ssSlideA = document.getElementById('ssSlideA') as HTMLImageElement

  if (screensaverSlides.length > 0) ssSlideA.src = screensaverSlides[0]

  // Camera
  statusEl.textContent = 'Requesting camera...'
  const video = document.createElement('video')
  video.autoplay = true
  video.playsInline = true
  video.muted = true

  let rawStream: MediaStream | null = null
  // Canvas-based rotation: when portraitCam is on, we draw the video rotated into rotCanvas
  // each frame and feed that to the tracker/segmenter instead of the raw video element.
  // streamRotated = true means the source fed to tracker/segmenter is already upright.
  let rotCanvas: HTMLCanvasElement | null = null
  let rotCtx: CanvasRenderingContext2D | null = null
  let streamRotated = false

  async function setupCamera(applyRotation: boolean): Promise<boolean> {
    if (rawStream) rawStream.getTracks().forEach(t => t.stop())
    try {
      rawStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false,
      })
    } catch {
      loadingMsg.textContent = 'Camera access denied — please allow camera and reload.'
      statusEl.textContent = 'Camera unavailable'
      return false
    }
    video.srcObject = rawStream
    await new Promise<void>((res) => { video.onloadedmetadata = () => res() })
    await video.play()
    if (applyRotation) {
      // Create an off-screen canvas with swapped dimensions (landscape video → portrait canvas)
      const vW = video.videoWidth, vH = video.videoHeight
      rotCanvas = document.createElement('canvas')
      rotCanvas.width = vH   // portrait: height becomes width
      rotCanvas.height = vW
      rotCtx = rotCanvas.getContext('2d')!
      streamRotated = true
    } else {
      rotCanvas = null
      rotCtx = null
      streamRotated = false
    }
    return true
  }

  const ok = await setupCamera(portraitCam)
  if (!ok) return

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

  // MediaPipe pose + hands
  const tracker = new Tracker()
  try {
    await tracker.init((msg) => { loadingMsg.textContent = msg })
  } catch (err) {
    loadingMsg.textContent = `Model load failed: ${(err as Error).message}`
    return
  }

  // RVM segmenter (loads separately — non-blocking after pose+hands are ready)
  const segmenter = new RVMSegmenter()
  loadingEl.style.display = 'none'
  statusEl.textContent = 'Tracking active'
  bgBtn.textContent = 'Replace Background (loading…)'
  bgBtn.disabled = true
  segmenter.init((msg) => { statusEl.textContent = msg }).then(() => {
    statusEl.textContent = `Ready · seg: ${segmenter.backend}`
    bgBtn.textContent = 'Replace Background'
    bgBtn.disabled = false
  }).catch((err) => {
    console.error('RVM segmenter failed:', err)
    bgBtn.textContent = 'Replace Background (unavailable)'
    statusEl.textContent = 'Segmenter unavailable'
  })

  // Fade out hint after 8s
  setTimeout(() => {
    hintEl.style.transition = 'opacity 1.5s'
    hintEl.style.opacity = '0'
  }, 8000)

  // UI — menu hidden by default, toggled via the settings button
  const uiEl = document.getElementById('ui') as HTMLDivElement
  const fullscreenBtn = document.getElementById('fullscreenBtn') as HTMLButtonElement
  fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen()
    } else {
      document.exitFullscreen()
    }
  })
  document.addEventListener('fullscreenchange', () => {
    fullscreenBtn.textContent = document.fullscreenElement ? '✕' : '⛶'
  })

  const menuBtn = document.getElementById('menuBtn') as HTMLButtonElement
  let menuOpen = false
  menuBtn.addEventListener('click', () => {
    menuOpen = !menuOpen
    uiEl.style.display = menuOpen ? 'flex' : 'none'
    menuBtn.classList.toggle('active', menuOpen)
  })

  // Restore button states from saved settings
  debugBtn.classList.toggle('active', debugMode)
  portraitCamBtn.classList.toggle('active', portraitCam)
  flipVBtn.classList.toggle('active', flipV)
  flipHBtn.classList.toggle('active', flipH)
  screensaverBtn.classList.toggle('active', screensaverEnabled)
  bgBtn.classList.toggle('active', bgEnabled)
  bgPicker.value = bgColor

  debugBtn.addEventListener('click', () => {
    debugMode = !debugMode
    debugBtn.classList.toggle('active', debugMode)
    LS.set('debugMode', debugMode ? '1' : '0')
  })
  portraitCamBtn.addEventListener('click', async () => {
    portraitCam = !portraitCam
    portraitCamBtn.classList.toggle('active', portraitCam)
    LS.set('portraitCam', portraitCam ? '1' : '0')
    await setupCamera(portraitCam)
    segmenter.resetState()
  })
  flipVBtn.addEventListener('click', () => {
    flipV = !flipV
    flipVBtn.classList.toggle('active', flipV)
    LS.set('flipV', flipV ? '1' : '0')
  })
  flipHBtn.addEventListener('click', () => {
    flipH = !flipH
    flipHBtn.classList.toggle('active', flipH)
    LS.set('flipH', flipH ? '1' : '0')
  })
  screensaverBtn.addEventListener('click', () => {
    screensaverEnabled = !screensaverEnabled
    screensaverBtn.classList.toggle('active', screensaverEnabled)
    LS.set('screensaverEnabled', screensaverEnabled ? '1' : '0')
    if (!screensaverEnabled) {
      personAbsentMs = 0
      screensaverAlpha = 0
      screensaverOverlay.style.opacity = '0'
    }
  })
  addBtn.addEventListener('click', () => {
    const toAdd = MAX_OBJECTS - physics.floatingObjects.length
    for (let i = 0; i < toAdd; i++) spawnNext()
  })
  clearBtn.addEventListener('click', () => physics.clearObjects())
  bgBtn.addEventListener('click', () => {
    bgEnabled = !bgEnabled
    bgBtn.classList.toggle('active', bgEnabled)
    LS.set('bgEnabled', bgEnabled ? '1' : '0')
  })
  bgPicker.addEventListener('input', () => {
    bgColor = bgPicker.value
    LS.set('bgColor', bgColor)
  })

  // Background image upload
  const bgImageInput = document.getElementById('bgImageInput') as HTMLInputElement
  const bgImageBtn = document.getElementById('bgImageBtn') as HTMLButtonElement
  const clearBgImageBtn = document.getElementById('clearBgImageBtn') as HTMLButtonElement

  function updateBgImageBtn() {
    bgImageBtn.textContent = bgImage ? 'BG Image ✓' : 'Upload BG Image'
    bgImageBtn.classList.toggle('active', bgImage !== null)
    clearBgImageBtn.style.display = bgImage ? 'inline-block' : 'none'
  }
  updateBgImageBtn()

  bgImageBtn.addEventListener('click', () => bgImageInput.click())
  bgImageInput.addEventListener('change', () => {
    const file = bgImageInput.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => {
      const dataUrl = e.target!.result as string
      const img = new Image()
      img.onload = () => {
        // Resize to max 1280×720 JPEG before storing to stay within localStorage limits
        const scale = Math.min(1, 1280 / img.naturalWidth, 720 / img.naturalHeight)
        const w = Math.round(img.naturalWidth * scale)
        const h = Math.round(img.naturalHeight * scale)
        const c = document.createElement('canvas')
        c.width = w; c.height = h
        c.getContext('2d')!.drawImage(img, 0, 0, w, h)
        const compressed = c.toDataURL('image/jpeg', 0.85)
        const out = new Image()
        out.src = compressed
        out.onload = () => {
          bgImage = out
          try { LS.set('bgImage', compressed) } catch { /* quota exceeded */ }
          updateBgImageBtn()
        }
      }
      img.src = dataUrl
    }
    reader.readAsDataURL(file)
    bgImageInput.value = ''
  })
  clearBgImageBtn.addEventListener('click', () => {
    bgImage = null
    LS.del('bgImage')
    updateBgImageBtn()
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

  function loop(ts: number) {
    const dt = Math.min(ts - prevTimestamp, 50)
    prevTimestamp = ts
    // Convert normalised MediaPipe coords → canvas pixels, respecting all orientation flags.
    // In portrait-cam mode the camera is rotated 90° CCW, so x/y axes are swapped and
    // we apply the same -90° cover-fit transform that the renderer uses for the video.
    const lm2canvas = (lmx: number, lmy: number): [number, number] => {
      const W = canvas.width, H = canvas.height
      if (portraitCam && !streamRotated) {
        const vW = video.videoWidth || W
        const vH = video.videoHeight || H
        const s  = Math.max(W / vH, H / vW)
        const sy = flipH ? -1 : 1   // in rotated local space, flipH acts on Y axis
        const sx = flipV ? -1 : 1   // and flipV acts on X axis
        return [
          W / 2 + sy * (lmy - 0.5) * vH * s,
          H / 2 - sx * (lmx - 0.5) * vW * s,
        ]
      }
      return [
        (flipH ? 1 - lmx : lmx) * W,
        (flipV ? 1 - lmy : lmy) * H,
      ]
    }

    // --- Update rotation canvas (portrait cam: draw video rotated 90° CW each frame) ---
    if (streamRotated && rotCanvas && rotCtx && video.readyState >= 2 && video.videoWidth > 0) {
      const vW = video.videoWidth, vH = video.videoHeight
      // Ensure canvas dimensions match (in case video dimensions changed)
      if (rotCanvas.width !== vH || rotCanvas.height !== vW) {
        rotCanvas.width = vH
        rotCanvas.height = vW
      }
      rotCtx.save()
      rotCtx.translate(vH / 2, vW / 2)
      rotCtx.rotate(Math.PI / 2)
      rotCtx.drawImage(video, -vW / 2, -vH / 2, vW, vH)
      rotCtx.restore()
    }
    const trackSource: HTMLVideoElement | HTMLCanvasElement = (streamRotated && rotCanvas) ? rotCanvas : video
    frameCount++

    // --- Tracking (every 2nd frame — MediaPipe is expensive; physics interpolates between) ---
    if (frameCount % 2 === 0) {
      const trackReady = streamRotated
        ? (rotCanvas !== null && video.readyState >= 2 && video.videoWidth > 0)
        : (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0)
      const result = trackReady ? tracker.detect(trackSource, ts) : null
      if (result) {
        lastPose = result.pose
        lastHands = result.hands
      }
    }

    // --- RVM segmentation (worker-backed: non-blocking; guard prevents overlapping calls) ---
    if (bgEnabled && !segmentPending) {
      segmentPending = true
      segmenter.segment(trackSource).then(mask => {
        if (mask) lastSeg = mask
        segmentPending = false
      }).catch(() => { segmentPending = false })
    }
    // Clear stale mask when background replacement is turned off
    if (!bgEnabled && lastSeg) lastSeg = null

    // --- Pose → physics bodies ---
    if (lastPose && lastPose.landmarks.length > 0) {
      const lms = lastPose.landmarks[0]

      // Compute shoulder width in screen space — used as distance proxy for head radius.
      // Wider shoulders = closer to camera = bigger head collider.
      const ls = lms[11], rs = lms[12]
      const shoulderPxDist = (ls && rs && (ls.visibility ?? 1) >= 0.3 && (rs.visibility ?? 1) >= 0.3)
        ? (() => { const [lx,ly] = lm2canvas(ls.x,ls.y); const [rx,ry] = lm2canvas(rs.x,rs.y); return Math.hypot(lx-rx,ly-ry) })()
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
        let [lx, ly] = lm2canvas(lm.x, lm.y)
        const elbowIdx = WRIST_ELBOW[idx]
        if (elbowIdx !== undefined) {
          const elbow = lms[elbowIdx]
          if (elbow && (elbow.visibility ?? 1) >= 0.3) {
            const [ex, ey] = lm2canvas(elbow.x, elbow.y)
            lx = ex + (lx - ex) * 0.7
            ly = ey + (ly - ey) * 0.7
          }
        }
        const radius = idx === 0 ? HEAD_RADIUS : BODY_RADIUS
        // Shift head collider up from nose so it centers on the skull
        const finalLy = idx === 0 ? ly - HEAD_RADIUS * 0.8 : ly
        physics.updateLandmark(`p${idx}`, lx, finalLy, radius)
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
        const [ax, ay] = lm2canvas(lmA.x, lmA.y)
        const [bx, by] = lm2canvas(lmB.x, lmB.y)
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

        // Palm center in canvas coords
        const palm = getPalmCenter(lms)
        const [px, py] = lm2canvas(palm.x, palm.y)

        // Grab radius = wrist to palm center distance (palm length, not full finger reach)
        const wrist = lms[0]
        const [wristX, wristY] = lm2canvas(wrist.x, wrist.y)
        const handReach = Math.hypot(wristX - px, wristY - py)

        // Hand rotation angle: wrist → middle knuckle direction in canvas space
        const midMcp = lms[9]
        const [midMcpX, midMcpY] = lm2canvas(midMcp.x, midMcp.y)
        const handAngle = Math.atan2(midMcpY - wristY, midMcpX - wristX)

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
          const [px, py] = lm2canvas(palm.x, palm.y)
          const wrist = lms[0]
          const [wristX, wristY] = lm2canvas(wrist.x, wrist.y)
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
        physics.pushFromTorso([s11, s12, h24, h23].map(lm => { const [x,y] = lm2canvas(lm.x,lm.y); return {x,y} }))
      }

      // Neck/head triangle: nose + shoulders
      if (nose && s11 && s12 &&
          (nose.visibility ?? 1) >= 0.3 && (s11.visibility ?? 1) >= 0.3 && (s12.visibility ?? 1) >= 0.3) {
        physics.pushFromTorso([nose, s11, s12].map(lm => { const [x,y] = lm2canvas(lm.x,lm.y); return {x,y} }))
      }
    }

    // --- Screensaver: fade in after 3s of absent/small person, fade out when they return ---
    if (screensaverEnabled) {
      // "Present" = pose detected AND shoulders are wide enough (person close enough to screen)
      // Shoulder pixel distance > 12% of canvas width means the person is meaningfully present
      let personPresent = false
      if ((lastPose?.landmarks.length ?? 0) > 0) {
        const lms = lastPose!.landmarks[0]
        const ls = lms[11], rs = lms[12]
        if (ls && rs && (ls.visibility ?? 1) >= 0.4 && (rs.visibility ?? 1) >= 0.4) {
          const [lx, ly] = lm2canvas(ls.x, ls.y)
          const [rx, ry] = lm2canvas(rs.x, rs.y)
          const shoulderPx = Math.hypot(lx - rx, ly - ry)
          personPresent = shoulderPx > canvas.width * 0.12
        }
      }

      if (personPresent) {
        personAbsentMs = 0
        screensaverAlpha = Math.max(0, screensaverAlpha - dt / 600)
      } else {
        personAbsentMs += dt
        if (personAbsentMs > 3000) {
          screensaverAlpha = Math.min(1, screensaverAlpha + dt / 1500)
        }
      }
      screensaverOverlay.style.opacity = screensaverAlpha > 0.005 ? String(screensaverAlpha) : '0'
    }

    // --- Render ---
    // When the stream is already rotated at source, renderer must not re-rotate
    const rendererPortraitCam = portraitCam && !streamRotated
    renderFrame(ctx, trackSource, physics.floatingObjects, lastPose, lastHands, debugMode, grabbing, hoverObjects, images, lastSeg, bgColor, bgImage, bgEnabled, screensaverAlpha, ts, PRODUCT_INFO, flipV, flipH, rendererPortraitCam)

    requestAnimationFrame(loop)
  }

  requestAnimationFrame(loop)
}

main().catch(console.error)
