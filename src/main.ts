import { Tracker, detectFist, getPalmCenter } from './tracker'
import { PhysicsScene } from './physics'
import { renderFrame } from './renderer'
import type { PoseLandmarkerResult, HandLandmarkerResult, ImageSegmenterResult } from './tracker'

const BODY_INDICES = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]
const BODY_RADIUS = 26

// Limb segment pairs: each gets a midpoint collision body so the full limb pushes objects
// Pose indices: 11/12=shoulders, 13/14=elbows, 15/16=wrists, 23/24=hips, 25/26=knees, 27/28=ankles
const LIMB_PAIRS: [number, number][] = [
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
  const bgBtn = document.getElementById('bgBtn') as HTMLButtonElement
  const bgPicker = document.getElementById('bgPicker') as HTMLInputElement
  const hintEl = document.getElementById('hint') as HTMLDivElement

  let debugMode = true
  let bgEnabled = false
  let bgColor = '#00ff88'
  let lastPose: PoseLandmarkerResult | null = null
  let lastHands: HandLandmarkerResult | null = null
  let lastSeg: ImageSegmenterResult | null = null
  let prevTimestamp = 0

  // Camera
  statusEl.textContent = 'Requesting camera...'
  const video = document.createElement('video')
  video.autoplay = true
  video.playsInline = true
  video.muted = true

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: false,
    })
    video.srcObject = stream
    await new Promise<void>((res) => { video.onloadedmetadata = () => res() })
    await video.play()
  } catch {
    loadingMsg.textContent = 'Camera access denied — please allow camera and reload.'
    statusEl.textContent = 'Camera unavailable'
    return
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

  // Spawn initial floating objects
  for (let i = 0; i < 10; i++) physics.spawnObject()

  // MediaPipe
  const tracker = new Tracker()
  try {
    await tracker.init((msg) => { loadingMsg.textContent = msg })
  } catch (err) {
    loadingMsg.textContent = `Model load failed: ${(err as Error).message}`
    return
  }

  loadingEl.style.display = 'none'
  statusEl.textContent = 'Tracking active'

  // Fade out hint after 8s
  setTimeout(() => {
    hintEl.style.transition = 'opacity 1.5s'
    hintEl.style.opacity = '0'
  }, 8000)

  // UI
  debugBtn.classList.add('active')
  debugBtn.addEventListener('click', () => {
    debugMode = !debugMode
    debugBtn.classList.toggle('active', debugMode)
  })
  addBtn.addEventListener('click', () => {
    for (let i = 0; i < 4; i++) physics.spawnObject()
  })
  clearBtn.addEventListener('click', () => physics.clearObjects())
  bgBtn.addEventListener('click', () => {
    bgEnabled = !bgEnabled
    bgBtn.classList.toggle('active', bgEnabled)
  })
  bgPicker.addEventListener('input', () => { bgColor = bgPicker.value })

  // Per-hand pinch tracking
  const pinchWas = new Map<number, boolean>()

  function loop(ts: number) {
    const dt = Math.min(ts - prevTimestamp, 50)
    prevTimestamp = ts

    // --- Tracking ---
    const result = tracker.detect(video, ts)
    if (result) {
      lastPose = result.pose
      lastHands = result.hands
      lastSeg = result.segmentation
    }

    // --- Pose → physics bodies ---
    if (lastPose && lastPose.landmarks.length > 0) {
      const lms = lastPose.landmarks[0]

      // Joint endpoint bodies
      for (const idx of BODY_INDICES) {
        const lm = lms[idx]
        if (!lm || (lm.visibility ?? 1) < 0.3) {
          physics.parkLandmark(`p${idx}`)
          continue
        }
        physics.updateLandmark(`p${idx}`, (1 - lm.x) * canvas.width, lm.y * canvas.height, BODY_RADIUS)
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
          physics.releaseGrab(i, 0, 0)
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
          physics.releaseGrab(i, px, py)
        }

        pinchWas.set(i, pinching)
      }
    }

    // Build grab map for renderer
    const grabbing = new Map<number, boolean>()
    if (lastHands) {
      for (let i = 0; i < lastHands.landmarks.length; i++) {
        grabbing.set(i, physics.isGrabbing(i))
      }
    }

    // --- Step physics ---
    physics.step(dt)

    // --- Render ---
    renderFrame(ctx, video, physics.floatingObjects, lastPose, lastHands, debugMode, grabbing, lastSeg, bgColor, bgEnabled)

    requestAnimationFrame(loop)
  }

  requestAnimationFrame(loop)
}

main().catch(console.error)
