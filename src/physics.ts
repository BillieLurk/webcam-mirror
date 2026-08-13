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
  /** Total lifespan in ms. */
  lifespan: number
  /** Current age in ms. Paused while grabbed; reset to 0 on grab. */
  age: number
  /** Visual scale 0–1 driven by spawn/death animations. */
  scale: number
  /** Visual alpha 0–1, matches scale. */
  alpha: number
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

function pointInPolygon(px: number, py: number, poly: { x: number; y: number }[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export class PhysicsScene {
  engine: Matter.Engine
  floatingObjects: FloatingObject[] = []
  private landmarkBodies = new Map<string, Matter.Body>()
  private grabMap = new Map<number, GrabState>()
  private walls: Matter.Body[] = []
  private time = 0  // accumulated seconds, for sway oscillation
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
      frictionAir: 0.018,
      friction: 0.0,
      density: 0.0004,
      collisionFilter: { category: 0x0002, group: 0, mask: 0xFFFFFFFF },
    }

    const body = Bodies.rectangle(cx, cy, bodyW, bodyH, opts)
    Body.setAngle(body, Math.random() * Math.PI * 2)
    // Gentle balloon-like drift in a random direction
    const driftAngle = Math.random() * Math.PI * 2
    const driftSpeed = 0.3 + Math.random() * 0.7
    Body.setVelocity(body, { x: Math.cos(driftAngle) * driftSpeed, y: Math.sin(driftAngle) * driftSpeed })

    const lifespan = 12000 + Math.random() * 13000  // 12–25 s
    const radius = Math.hypot(bodyW, bodyH) / 2
    const obj: FloatingObject = { body, imageKey, drawW, drawH, drawX, drawY, radius, grabbed: false, lifespan, age: 0, scale: 0, alpha: 0 }
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
      // Reset remaining life without replaying spawn animation
      best.lifespan = best.age + 12000 + Math.random() * 13000
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
    // Velocity = actual body movement this frame (smooth, not raw hand delta)
    // Raw hand delta is still recorded separately for throw calculation
    Body.setVelocity(state.object.body, { x: tx - cx, y: ty - cy })
    // Lerp rotation toward target angle
    const targetAngle = state.grabObjectAngle + (handAngle - state.grabHandAngle)
    const currentAngle = state.object.body.angle
    // Normalize diff to [-π, π] to prevent spinning the long way around at ±π boundary
    let angleDiff = (targetAngle - currentAngle + Math.PI * 3) % (Math.PI * 2) - Math.PI
    Body.setAngle(state.object.body, currentAngle + angleDiff * LERP)
    Body.setAngularVelocity(state.object.body, 0)
    // Record raw hand velocity for throw calculation
    const handVx = px - state.prevPx
    const handVy = py - state.prevPy
    state.velHistory.push({ x: handVx, y: handVy })
    if (state.velHistory.length > 6) state.velHistory.shift()

    state.prevPx = px
    state.prevPy = py
  }

  releaseGrab(handIdx: number) {
    const state = this.grabMap.get(handIdx)
    if (state) {
      state.object.grabbed = false
      Body.set(state.object.body, { collisionFilter: { category: 0x0002, group: 0, mask: 0xFFFFFFFF } })

      // Body velocity is already set to hand movement from the last moveGrab frame.
      // Average the recent history for a smoother throw direction, then apply it.
      const hist = state.velHistory
      if (hist.length > 0) {
        let wx = 0, wy = 0, totalW = 0
        for (let i = 0; i < hist.length; i++) {
          const w = i + 1
          wx += hist[i].x * w
          wy += hist[i].y * w
          totalW += w
        }
        const clamp = (v: number, max: number) => Math.max(-max, Math.min(max, v))
        Body.setVelocity(state.object.body, {
          x: clamp(wx / totalW, 18),
          y: clamp(wy / totalW, 18),
        })
      }

      this.grabMap.delete(handIdx)
    }
  }

  isGrabbing(handIdx: number): boolean {
    return this.grabMap.has(handIdx)
  }

  // ---- Torso repulsion ----

  /**
   * Pushes floating objects out of the torso polygon (shoulders + hips form a closed box).
   * corners should be ordered: leftShoulder, rightShoulder, rightHip, leftHip.
   */
  pushFromTorso(corners: { x: number; y: number }[]) {
    if (corners.length < 3) return
    const cx = corners.reduce((s, p) => s + p.x, 0) / corners.length
    const cy = corners.reduce((s, p) => s + p.y, 0) / corners.length

    for (const obj of this.floatingObjects) {
      if (obj.grabbed) continue
      const { x, y } = obj.body.position
      const inside = pointInPolygon(x, y, corners)

      if (inside) {
        // Phase through landmark bodies (0x0004) so the object isn't blocked by torso walls
        Body.set(obj.body, { collisionFilter: { category: 0x0002, group: 0, mask: 0x0001 | 0x0002 } })
        const dx = x - cx
        const dy = y - cy
        const dist = Math.hypot(dx, dy) || 1
        const NUDGE = 14
        Body.setPosition(obj.body, { x: x + (dx / dist) * NUDGE, y: y + (dy / dist) * NUDGE })
        Body.setVelocity(obj.body, { x: (dx / dist) * NUDGE, y: (dy / dist) * NUDGE })
      } else if (((obj.body.collisionFilter.mask ?? 0xFFFFFFFF) & 0x0004) === 0) {
        // Object just escaped — restore full collisions
        Body.set(obj.body, { collisionFilter: { category: 0x0002, group: 0, mask: 0xFFFFFFFF } })
      }
    }
  }

  step(dt: number) {
    Engine.update(this.engine, dt)
    this.time += dt * 0.001  // ms → seconds

    const SPAWN_DUR = 600   // ms to grow in
    const DEATH_DUR = 800   // ms to fade out
    const MAX_SPEED = 14

    for (const obj of this.floatingObjects) {
      // Age only while not grabbed
      if (!obj.grabbed) obj.age = Math.min(obj.age + dt, obj.lifespan)

      // Compute scale/alpha: smoothstep in, full, smoothstep out
      const lifeLeft = obj.lifespan - obj.age
      let t: number
      if (obj.age < SPAWN_DUR) {
        t = obj.age / SPAWN_DUR
        obj.scale = t * t * (3 - 2 * t)
      } else if (lifeLeft < DEATH_DUR) {
        t = lifeLeft / DEATH_DUR
        obj.scale = t * t * (3 - 2 * t)
      } else {
        obj.scale = 1
      }
      obj.alpha = obj.scale

      if (obj.grabbed) continue
      const { x, y } = obj.body.velocity
      const speed = Math.hypot(x, y)
      if (speed > MAX_SPEED) {
        Body.setVelocity(obj.body, { x: x * MAX_SPEED / speed, y: y * MAX_SPEED / speed })
      }

      if (obj.scale >= 1) {
        const { x, y } = obj.body.position
        const m = obj.body.mass

        // Wall repulsion — pushes objects away from edges so they don't cluster there
        const margin = 180
        const edgeK = 0.00022 * m
        if (x < margin)               Body.applyForce(obj.body, obj.body.position, { x:  edgeK * (1 - x / margin), y: 0 })
        if (x > this.width - margin)  Body.applyForce(obj.body, obj.body.position, { x: -edgeK * (1 - (this.width - x) / margin), y: 0 })
        if (y < margin)               Body.applyForce(obj.body, obj.body.position, { x: 0, y:  edgeK * (1 - y / margin) })
        if (y > this.height - margin) Body.applyForce(obj.body, obj.body.position, { x: 0, y: -edgeK * (1 - (this.height - y) / margin) })

        // Aperiodic wandering sway — only when nearly still (delay after throw/grab)
        const curSpeed = Math.hypot(obj.body.velocity.x, obj.body.velocity.y)
        if (curSpeed < 1.5) {
          const id = obj.body.id
          const PHI = 1.6180339887
          const fBase = 0.012 + (id * 0.314159) % 0.018
          const pX1 = (id * 2.399963) % (Math.PI * 2)
          const pX2 = (id * 3.141592) % (Math.PI * 2)
          const pY1 = (id * 1.618033) % (Math.PI * 2)
          const pY2 = (id * 0.577215) % (Math.PI * 2)
          const A = 0.00022 * m
          Body.applyForce(obj.body, obj.body.position, {
            x: (Math.sin(this.time * fBase + pX1) * 0.7 + Math.sin(this.time * fBase * 2.414 + pX2) * 0.3) * A,
            y: (Math.sin(this.time * fBase * PHI + pY1) * 0.7 + Math.sin(this.time * fBase * PHI * 1.732 + pY2) * 0.3) * A,
          })
        }
      }
    }
  }

  /** Remove objects whose age has reached their lifespan. Returns count removed. */
  collectDeadObjects(): number {
    const dead = this.floatingObjects.filter(o => o.age >= o.lifespan)
    for (const obj of dead) World.remove(this.engine.world, obj.body)
    this.floatingObjects = this.floatingObjects.filter(o => o.age < o.lifespan)
    // Clean up any grabs pointing at dead objects
    for (const [idx, state] of this.grabMap) {
      if (!this.floatingObjects.includes(state.object)) this.grabMap.delete(idx)
    }
    return dead.length
  }
}
