import Matter from 'matter-js'

const { Engine, World, Bodies, Body, Composite } = Matter

export interface FloatingObject {
  body: Matter.Body
  imageKey: string
  /** Full image draw dimensions in local (body-centered) space. */
  drawW: number
  drawH: number
  /** Image origin offset so that the content center aligns with body center (0,0). */
  drawX: number
  drawY: number
  /** Half-diagonal of physics body — used for grab-radius detection. */
  radius: number
  grabbed: boolean
}

interface GrabState {
  object: FloatingObject
  offsetX: number
  offsetY: number
  prevPx: number
  prevPy: number
  grabHandAngle: number
  grabObjectAngle: number
  /** Rolling hand velocity history for throw calculation (last N frames). */
  velHistory: { x: number; y: number }[]
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

  spawnObject(
    imageKey: string,
    bodyW: number,
    bodyH: number,
    drawW: number,
    drawH: number,
    drawX: number,
    drawY: number,
    x?: number,
    y?: number,
  ): FloatingObject {
    const cx = x ?? 80 + Math.random() * (this.width - 160)
    const cy = y ?? 80 + Math.random() * (this.height * 0.55)

    const opts: Matter.IBodyDefinition = {
      restitution: 0.8,
      frictionAir: 0.012,
      friction: 0.0,
      density: 0.0004,
      collisionFilter: { category: 0x0002, group: 0, mask: 0xFFFFFFFF },
    }

    const body = Bodies.rectangle(cx, cy, bodyW, bodyH, opts)
    Body.setVelocity(body, { x: 0, y: 0 })

    const radius = Math.hypot(bodyW, bodyH) / 2
    const obj: FloatingObject = { body, imageKey, drawW, drawH, drawX, drawY, radius, grabbed: false }
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
        collisionFilter: { category: 0x0004, group: 0, mask: collides ? 0xFFFFFFFF : 0 },
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

  // ---- Hover detection ----

  getHoverObject(handIdx: number, px: number, py: number, reach: number): FloatingObject | null {
    if (this.grabMap.has(handIdx)) return null
    let best: FloatingObject | null = null
    let bestDist = reach
    for (const obj of this.floatingObjects) {
      if (obj.grabbed) continue
      const dx = obj.body.position.x - px
      const dy = obj.body.position.y - py
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d < bestDist) { best = obj; bestDist = d }
    }
    return best
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
      // While grabbed: collide only with other floating objects (0x0002), not landmarks or walls
      Body.set(best.body, { collisionFilter: { category: 0x0002, group: 0, mask: 0x0002 } })
      this.grabMap.set(handIdx, {
        object: best,
        offsetX: 0,
        offsetY: 0,
        prevPx: px,
        prevPy: py,
        grabHandAngle: handAngle,
        grabObjectAngle: best.body.angle,
        velHistory: [],
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
    // Record hand velocity for throw calculation
    state.velHistory.push({ x: px - state.prevPx, y: py - state.prevPy })
    if (state.velHistory.length > 6) state.velHistory.shift()

    state.prevPx = px
    state.prevPy = py
  }

  releaseGrab(handIdx: number) {
    const state = this.grabMap.get(handIdx)
    if (state) {
      state.object.grabbed = false
      Body.set(state.object.body, { collisionFilter: { category: 0x0002, group: 0, mask: 0xFFFFFFFF } })

      // Average recent hand velocities for a stable throw direction.
      // Weight recent frames more heavily (index 0 = oldest).
      const hist = state.velHistory
      if (hist.length > 0) {
        let wx = 0, wy = 0, totalW = 0
        for (let i = 0; i < hist.length; i++) {
          const w = i + 1  // later frames have higher weight
          wx += hist[i].x * w
          wy += hist[i].y * w
          totalW += w
        }
        const clamp = (v: number, max: number) => Math.max(-max, Math.min(max, v))
        Body.setVelocity(state.object.body, {
          x: clamp((wx / totalW) * 3.5, 30),
          y: clamp((wy / totalW) * 3.5, 30),
        })
      } else {
        Body.setVelocity(state.object.body, { x: 0, y: 0 })
      }

      this.grabMap.delete(handIdx)
    }
  }

  isGrabbing(handIdx: number): boolean {
    return this.grabMap.has(handIdx)
  }

  step(dt: number) {
    Engine.update(this.engine, dt)
    // Cap speed so objects can't be launched off-screen
    const MAX_SPEED = 30
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
