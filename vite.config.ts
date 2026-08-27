import { defineConfig } from 'vite'
import fs from 'fs'
import path from 'path'

// Virtual module: auto-discovers images in public/assets/screensavers/ at build time
const screensaverPlugin = {
  name: 'virtual-screensavers',
  resolveId(id: string) {
    if (id === 'virtual:screensavers') return '\0virtual:screensavers'
  },
  load(id: string) {
    if (id === '\0virtual:screensavers') {
      const dir = path.resolve(__dirname, 'public/assets/screensavers')
      let files: string[] = []
      try {
        files = fs.readdirSync(dir)
          .filter(f => /\.(png|jpe?g|webp|gif|avif)$/i.test(f))
          .map(f => `/assets/screensavers/${f}`)
      } catch { /* folder missing → empty list */ }
      return `export default ${JSON.stringify(files)}`
    }
  },
}

export default defineConfig({
  plugins: [screensaverPlugin],
  optimizeDeps: {
    exclude: ['@mediapipe/tasks-vision'],
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      onwarn(warning, warn) {
        if (warning.code === 'SOURCEMAP_ERROR') return
        warn(warning)
      },
    },
  },
  server: {
    fs: { strict: false },
    headers: {
      // Required for SharedArrayBuffer (WASM multi-threading in ORT worker)
      // credentialless COEP allows cross-origin CDN resources without CORP headers
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
})
