import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx'],
    exclude: ['.worktrees/**', 'node_modules/**', '.next/**', 'dist/**'],
  },
  resolve: {
    alias: [
      { find: '@', replacement: resolve(__dirname, './') },
      { find: '@tests/', replacement: resolve(__dirname, './tests') + '/' },
    ],
  },
})