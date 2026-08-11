import Matter from 'matter-js'

const { Engine, World, Bodies, Body, Composite } = Matter

export interface FloatingObject {
  body: Matter.Body
  shape: 'circle' | 'rect' | 'polygon'
  color: string
  label: string
  radius: number
  grabbed: boolean
}

const COLORS = [
  '#ff6b9d', '#c77dff', '#4cc9f0', '#f77f00',
  '#06ffa5', '#ffbe0b', '#fb5607', '#8338ec', '#3a86ff',
]
const LABELS = ['⭐', '🌙', '🔮', '💎', '🎈', '🌟', '🎯', '🪄', '🎪', '🎭', '🌈', '⚡', '🦋', '🍀']

interface GrabState {
  object: FloatingObject
  offsetX: number
  offsetY: number
  prevPx: number
  prevPy: number
  grabHandAngle: number
  grabObjectAngle: number
}

export class PhysicsScene {
  engine: Matter.Engine
  floatingObjects: FloatingObject[] = []
  private landmarkBodies = new Map<string, Matter.Body>()
  private grabMap = new Map<number, GrabState>()
  private walls: Matter.Body[] = []
  width: number
  height: number

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.engine = Engine.create({ gravity: { x: 0, y: 0 } })
    this.buildWalls()
  }

  private buildWalls() {
    const T = 100
    const { width: W, height: H } = this
    this.walls = [
      Bodies.rectangle(W / 2, -T / 2, W + T * 2, T, { isStatic: true, label: 'wall' }),
      Bodies.rectangle(W / 2, H + T / 2, W + T * 2, T, { isStatic: true, label: 'wall' }),
      Bodies.rectangle(-T / 2, H / 2, T, H + T * 2, { isStatic: true, label: 'wall' }),
      Bodies.rectangle(W + T / 2, H / 2, T, H + T * 2, { isStatic: true, label: 'wall' }),
    ]
    Composite.add(this.engine.world, this.walls)
  }

  resize(width: number, height: number) {
    this.width = width
    this.height = height
    for (const w of this.walls) World.remove(this.engine.world, w)
    this.buildWalls()
  }

  spawnObject(x?: number, y?: number): FloatingObject {
    const cx = x ?? 80 + Math.random() * (this.width - 160)
    const cy = y ?? 80 + Math.random() * (this.height * 0.55)
    const t = Math.floor(Math.random() * 3)
    const color = COLORS[Math.floor(Math.random() * COLORS.length)]
    const label = LABELS[Math.floor(Math.random() * LABELS.length)]
    const r = 30 + Math.random() * 22

    const opts: Matter.IBodyDefinition = {
      restitution: 0.8,
      frictionAir: 0.012,  // slow damping — drifts to rest like a balloon
      friction: 0.0,
      density: 0.0004,
    }

    let body: Matter.Body
    let shape: FloatingObject['shape']

    if (t === 0) {
      body = Bodies.circle(cx, cy, r, opts)
      shape = 'circle'
    } else if (t === 1) {
      body = Bodies.rectangle(cx, cy, r * 2.2, r * 2.2, opts)
      shape = 'rect'
    } else {
      const sides = 5 + Math.floor(Math.random() * 3) // 5, 6, or 7
      body = Bodies.polygon(cx, cy, sides, r, opts)
      shape = 'polygon'
    }

    // No initial velocity — balloons just hover until disturbed
    Body.setVelocity(body, { x: 0, y: 0 })

    const obj: FloatingObject = { body, shape, color, label, radius: r, grabbed: false }
    this.floatingObjects.push(obj)
    Composite.add(this.engine.world, body)
    return obj
  }

  clearObjects() {
    for (const obj of this.floatingObjects) World.remove(this.engine.world, obj.body)
    this.floatingObjects = []
    this.grabMap.clear()
  }

  // ---- Landmark kinematic bodies ----

  updateLandmark(id: string, cx: number, cy: number, radius: number, collides = true) {
    let body = this.landmarkBodies.get(id)
    if (!body) {
      body = Bodies.circle(cx, cy, radius, {
        isStatic: true,
        label: `lm_${id}`,
        restitution: 0.4,
        friction: 0,
        frictionAir: 0,
        collisionFilter: { mask: collides ? 0xFFFFFFFF : 0 },
      })
      this.landmarkBodies.set(id, body)
      Composite.add(this.engine.world, body)
    } else {
      // Set velocity so collision response feels physical (static bodies use this for pushing)
      const vx = cx - body.position.x
      const vy = cy - body.position.y
      Body.setVelocity(body, { x: vx, y: vy })
      Body.setPosition(body, { x: cx, y: cy })
    }
  }

  parkLandmark(id: string) {
    const body = this.landmarkBodies.get(id)
    if (body) Body.setPosition(body, { x: -600, y: -600 })
  }

  // ---- Grab mechanics ----

  tryGrab(handIdx: number, px: number, py: number, reach: number, handAngle: number) {
    if (this.grabMap.has(handIdx)) return
    let best: FloatingObject | null = null
    let bestDist = reach

    for (const obj of this.floatingObjects) {
      if (obj.grabbed) continue
      const dx = obj.body.position.x - px
      const dy = obj.body.position.y - py
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d < bestDist) { best = obj; bestDist = d }
    }

    if (best) {
      best.grabbed = true
      // Disable collisions while held — must include category or Matter.js wipes it
      Body.set(best.body, { collisionFilter: { category: 0x0001, group: 0, mask: 0 } })
      this.grabMap.set(handIdx, {
        object: best,
        offsetX: 0,
        offsetY: 0,
        prevPx: px,
        prevPy: py,
        grabHandAngle: handAngle,
        grabObjectAngle: best.body.angle,
      })
    }
  }

  moveGrab(handIdx: number, px: number, py: number, handAngle: number) {
    const state = this.grabMap.get(handIdx)
    if (!state) return
    const LERP = 0.35
    const cx = state.object.body.position.x
    const cy = state.object.body.position.y
    const tx = cx + (px - cx) * LERP
    const ty = cy + (py - cy) * LERP
    Body.setPosition(state.object.body, { x: tx, y: ty })
    Body.setVelocity(state.object.body, { x: 0, y: 0 })
    // Lerp rotation toward target angle
    const targetAngle = state.grabObjectAngle + (handAngle - state.grabHandAngle)
    const currentAngle = state.object.body.angle
    Body.setAngle(state.object.body, currentAngle + (targetAngle - currentAngle) * LERP)
    Body.setAngularVelocity(state.object.body, 0)
    state.prevPx = px
    state.prevPy = py
  }

  releaseGrab(handIdx: number, px: number, py: number) {
    const state = this.grabMap.get(handIdx)
    if (state) {
      state.object.grabbed = false
      Body.set(state.object.body, { collisionFilter: { category: 0x0001, group: 0, mask: 0xFFFFFFFF } })
      // Small throw from last frame movement, capped so it can't leave the screen
      const clamp = (v: number, max: number) => Math.max(-max, Math.min(max, v))
      Body.setVelocity(state.object.body, {
        x: clamp((px - state.prevPx) * 1.5, 6),
        y: clamp((py - state.prevPy) * 1.5, 6),
      })
      this.grabMap.delete(handIdx)
    }
  }

  isGrabbing(handIdx: number): boolean {
    return this.grabMap.has(handIdx)
  }

  step(dt: number) {
    Engine.update(this.engine, dt)
    // Cap speed so objects can't be launched off-screen
    const MAX_SPEED = 14
    for (const obj of this.floatingObjects) {
      if (obj.grabbed) continue
      const { x, y } = obj.body.velocity
      const speed = Math.hypot(x, y)
      if (speed > MAX_SPEED) {
        Body.setVelocity(obj.body, { x: x * MAX_SPEED / speed, y: y * MAX_SPEED / speed })
      }
    }
  }
}
