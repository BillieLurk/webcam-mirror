/**
 * Depth camera relay server.
 *
 * The iPhone app connects as the "source" on /source.
 * The browser connects as a "viewer" on /view.
 * Binary frames from the iPhone are broadcast to all viewers verbatim.
 *
 * Frame wire format (binary, little-endian):
 *   [0]      uint8   frame type  0=color JPEG  1=depth Float32
 *   [1..4]   uint32  width
 *   [5..8]   uint32  height
 *   [9..12]  uint32  timestamp ms (wraps ~49 days)
 *   [13..]   bytes   payload
 *             color: raw JPEG bytes
 *             depth: Float32LE array, metres (0 = no data), width×height values
 *
 * Usage:
 *   node server/relay.js          (default port 8080)
 *   PORT=9000 node server/relay.js
 */

import { WebSocketServer, WebSocket } from 'ws'
import { createServer } from 'http'
import os from 'os'

const PORT = parseInt(process.env.PORT ?? '8080', 10)

// A single depth frame is ~1.8MB (1280x720 uint16mm) — a couple of frames'
// worth of backlog is a reasonable "still keeping up" threshold before we
// start dropping to that viewer.
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024

const httpServer = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('Depth relay running\n')
})

const wss = new WebSocketServer({ server: httpServer })

/** @type {WebSocket | null} */
let source = null

/** @type {Set<WebSocket>} */
const viewers = new Set()

wss.on('connection', (ws, req) => {
  const path = req.url ?? '/'

  if (path === '/source') {
    if (source) {
      console.log('Replacing existing source connection')
      source.close()
    }
    source = ws
    console.log('iPhone source connected')

    ws.on('message', (data, isBinary) => {
      if (!isBinary || viewers.size === 0) return
      for (const viewer of viewers) {
        if (viewer.readyState !== WebSocket.OPEN) continue
        // ws.send() buffers internally and never blocks — with no check here, a
        // viewer that can't drain as fast as frames arrive just accumulates an
        // ever-growing backlog in this process's memory (seen firsthand: relay
        // RSS climbed past 5GB), and the viewer falls further and further behind
        // real time since it still has to receive that backlog in order. Drop
        // frames to a viewer that's already behind instead — it'll catch back
        // up to "now" on the next frame rather than wading through stale ones.
        if (viewer.bufferedAmount > MAX_BUFFERED_BYTES) continue
        viewer.send(data, { binary: true })
      }
    })

    ws.on('close', () => {
      console.log('iPhone source disconnected')
      source = null
    })

  } else if (path === '/view') {
    viewers.add(ws)
    console.log(`Browser viewer connected (${viewers.size} total)`)

    ws.on('close', () => {
      viewers.delete(ws)
      console.log(`Browser viewer disconnected (${viewers.size} remaining)`)
    })

  } else {
    ws.close(1008, 'Unknown path — use /source or /view')
  }
})

httpServer.listen(PORT, '0.0.0.0', () => {
  // Print all local IPs so the user knows what to enter on iPhone
  const nets = os.networkInterfaces()
  const ips = []
  for (const iface of Object.values(nets)) {
    for (const addr of iface ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) ips.push(addr.address)
    }
  }
  console.log(`\nDepth relay listening on port ${PORT}`)
  console.log('Local network IPs:')
  for (const ip of ips) console.log(`  ws://${ip}:${PORT}`)
  console.log('\niBrowser: connect to /view')
  console.log('iPhone:  connect to /source\n')
})
