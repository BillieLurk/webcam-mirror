/**
 * Receives synced color + depth frames from the relay server and exposes
 * them for use in the renderer in place of the webcam + ML segmentation.
 *
 * Wire format (matches relay.js and DepthStreamer.swift):
 *   [0]      uint8   type  0=color JPEG  1=depth Float32LE metres  2=depth Uint16LE millimetres
 *   [1..4]   uint32LE  width
 *   [5..8]   uint32LE  height
 *   [9..12]  uint32LE  timestamp ms
 *   [13..]   payload
 *
 * Type 2 (uint16 mm) is a more compact depth encoding used by the Orbbec
 * sender — half the bytes of type 1 (float32 metres, used by the iPhone
 * sender), which matters a lot at 1280x720: 1.8MB vs 3.6MB per frame.
 */

export interface DepthFrame {
  colorBitmap: ImageBitmap
  depthData: Float32Array
  depthWidth: number
  depthHeight: number
}

export class DepthReceiver {
  private ws: WebSocket | null = null
  private pendingColor: { blob: Blob; ts: number } | null = null
  private pendingDepth: { data: Float32Array; w: number; h: number; ts: number } | null = null
  // Only one decode is ever in flight — while it's running, newer messages just
  // overwrite pendingColor/pendingDepth instead of each kicking off their own
  // createImageBitmap call. Without this, every single incoming frame starts its
  // own decode regardless of whether a newer one has already arrived, and since
  // none of them ever get cancelled, the backlog of in-flight decodes only grows
  // and the displayed frame falls further and further behind real time.
  private decoding = false

  onFrame: ((frame: DepthFrame) => void) | null = null
  onStatusChange: ((connected: boolean) => void) | null = null

  connect(url: string) {
    this.ws?.close()
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    this.ws = ws

    ws.onopen = () => this.onStatusChange?.(true)
    ws.onclose = () => this.onStatusChange?.(false)
    ws.onerror = () => this.onStatusChange?.(false)
    ws.onmessage = (ev) => this.handleMessage(ev.data as ArrayBuffer)
  }

  disconnect() {
    this.ws?.close()
    this.ws = null
    this.pendingColor = null
    this.pendingDepth = null
    this.decoding = false
  }

  get connected() { return this.ws?.readyState === WebSocket.OPEN }

  private async handleMessage(buf: ArrayBuffer) {
    const view = new DataView(buf)
    const type = view.getUint8(0)
    const width = view.getUint32(1, true)
    const height = view.getUint32(5, true)
    const ts = view.getUint32(9, true)
    const payload = buf.slice(13)

    if (type === 0) {
      // Color JPEG
      const blob = new Blob([payload], { type: 'image/jpeg' })
      this.pendingColor = { blob, ts }
      await this.tryEmit()
    } else if (type === 1) {
      // Depth Float32LE, already in metres
      const data = new Float32Array(payload)
      this.pendingDepth = { data, w: width, h: height, ts }
      await this.tryEmit()
    } else if (type === 2) {
      // Depth Uint16LE millimetres -> Float32 metres
      const raw = new Uint16Array(payload)
      const data = new Float32Array(raw.length)
      for (let i = 0; i < raw.length; i++) data[i] = raw[i] / 1000
      this.pendingDepth = { data, w: width, h: height, ts }
      await this.tryEmit()
    }
  }

  private async tryEmit() {
    // A decode is already running — its own completion will call tryEmit again,
    // which will pick up whatever the latest pending pair is by then. Starting
    // a second concurrent decode here is exactly what causes the backlog.
    if (this.decoding) return
    if (!this.pendingColor || !this.pendingDepth) return

    // Accept pairs within 100ms of each other
    const delta = Math.abs(this.pendingColor.ts - this.pendingDepth.ts)
    if (delta > 100) {
      // Drop the older one
      if (this.pendingColor.ts < this.pendingDepth.ts) {
        this.pendingColor = null
      } else {
        this.pendingDepth = null
      }
      return
    }

    const { blob } = this.pendingColor
    const { data, w, h } = this.pendingDepth
    this.pendingColor = null
    this.pendingDepth = null

    this.decoding = true
    try {
      const bitmap = await createImageBitmap(blob)
      this.onFrame?.({ colorBitmap: bitmap, depthData: data, depthWidth: w, depthHeight: h })
    } finally {
      this.decoding = false
    }

    // Newer messages may have arrived while we were decoding — jump straight to
    // the latest pending pair instead of leaving it for the next message event.
    await this.tryEmit()
  }
}
