import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Test-only config (never used by `vite build`). jsdom + React plugin give
// real render/interaction coverage for views and controls. import.meta.env
// is empty under vitest, so all VITE_* display metadata falls back — the
// App itself boots against mocked fetch in tests.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{js,jsx}'],
    testTimeout: 20000,
    setupFiles: ['./vitest.setup.js'],
  },
});
