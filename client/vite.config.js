import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Use '/' for local development, '/4-Node/' for GitHub Pages
  base: process.env.NODE_ENV === 'production' ? '/4-Node/' : '/',
})
