import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
const serverUrl = process.env.SYNCFORGE_SERVER_URL ?? 'http://localhost:3001'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/auth': serverUrl,
      '/health': serverUrl,
      '/socket.io': {
        target: serverUrl,
        ws: true,
      },
    },
  },
})
