import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Use '/' for Render Static Site deployment (and local development)
  // If you want to use GitHub Pages, change this to '/4-Node/'
  base: '/',
})
