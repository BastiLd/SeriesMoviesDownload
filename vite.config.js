import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Der Dev-Server leitet API-Anfragen an Sonarr/Radarr/Prowlarr/qBittorrent weiter.
// Dadurch gibt es KEINE Browser-Sicherheitsprobleme (CORS).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    open: true,
    proxy: {
      '/radarr':   { target: 'http://localhost:7878', changeOrigin: true, rewrite: p => p.replace(/^\/radarr/, '') },
      '/sonarr':   { target: 'http://localhost:8989', changeOrigin: true, rewrite: p => p.replace(/^\/sonarr/, '') },
      '/prowlarr': { target: 'http://localhost:9696', changeOrigin: true, rewrite: p => p.replace(/^\/prowlarr/, '') },
      '/qbt':      { target: 'http://localhost:8200', changeOrigin: true, rewrite: p => p.replace(/^\/qbt/, '') },
      // Lokales Ollama (Standard-Port 11434). Liegt dein Ollama woanders (z.B. Server),
      // setze OLLAMA_URL beim Start:  set OLLAMA_URL=http://192.168.68.10:11434 && npm run dev
      '/ollama':   { target: process.env.OLLAMA_URL || 'http://localhost:11434', changeOrigin: true, rewrite: p => p.replace(/^\/ollama/, '') },
    },
  },
})
