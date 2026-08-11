/**
 * Receives synced color + depth frames from the relay server and exposes
 * them for use in the renderer in place of the webcam + ML segmentation.
 *
 * Wire format (matches relay.js and DepthStreamer.swift):
 *   [0]      uint8   type  0=color JPEG  1=depth Float32LE metres
 *   [1..4]   uint32LE  width
 *   [5..8]   uint32LE  height
 *   [9..12]  uint32LE  timestamp ms
 *   [13..]   payload
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
      // Depth Float32LE
      const data = new Float32Array(payload)
      this.pendingDepth = { data, w: width, h: height, ts }
      await this.tryEmit()
    }
  }

  private async tryEmit() {
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

    const bitmap = await createImageBitmap(blob)
    this.onFrame?.({ colorBitmap: bitmap, depthData: data, depthWidth: w, depthHeight: h })
  }
}
