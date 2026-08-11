import { defineConfig } from 'vite'

export default defineConfig({
  optimizeDeps: {
    exclude: ['@mediapipe/tasks-vision'],
  },
})
