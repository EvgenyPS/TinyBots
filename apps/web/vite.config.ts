import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Dev-сервер тоже только на loopback: флаг --host без адреса открыл бы все интерфейсы.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
  },
})
