import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')

  return {
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
              return 'react-vendor'
            }
            if (id.includes('node_modules/d3') || id.includes('node_modules/framer-motion') || id.includes('node_modules/react-icons')) {
              return 'visual-vendor'
            }
            return undefined
          },
        },
      },
    },
    server: {
      fs: {
        strict: true,
      },
      proxy: {
        '/api': {
          target: env.VITE_DEV_BACKEND_URL || 'http://localhost:8000',
          changeOrigin: true,
        },
      },
    },
  }
})
