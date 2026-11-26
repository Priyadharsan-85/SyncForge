import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
const serverUrl = process.env.SYNCFORGE_SERVER_URL ?? 'http://localhost:3001'

export default defineConfig({
  plugins: [react()],
  build: {
    // Monaco's core is a ~2.7 MB chunk by design. It is lazy-loaded with the
    // editor, so it never blocks first paint; don't warn about it.
    chunkSizeWarningLimit: 3000,
  },
  server: {
    proxy: {
      '/api': serverUrl,
      '/auth': serverUrl,
      '/health': serverUrl,
      '/ready': serverUrl,
      '/metrics': serverUrl,
      '/socket.io': {
        target: serverUrl,
        ws: true,
      },
    },
  },
})
