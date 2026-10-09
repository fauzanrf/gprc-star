import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/starlink/',
  plugins: [react()],
  server: {
    proxy: {
      '/starlink/api': { target: 'http://backend:8000', rewrite: (path) => path.replace(/^\/starlink\/api/, '/api'), changeOrigin: true },
      '/starlink/ws':  { target: 'ws://backend:8000', rewrite: (path) => path.replace(/^\/starlink\/ws/, '/ws'), ws: true, changeOrigin: true },
      '/api': { target: 'http://backend:8000', changeOrigin: true },
      '/ws':  { target: 'ws://backend:8000',  ws: true, changeOrigin: true },
    }
  }
})
