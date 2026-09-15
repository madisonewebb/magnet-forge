/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    // Pure-logic modules (web/src/lib/**) only — no DOM/canvas environment
    // is configured since there are no component tests yet.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
