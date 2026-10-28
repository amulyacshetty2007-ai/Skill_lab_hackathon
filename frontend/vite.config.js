import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev the API runs on :4000; the proxy keeps everything same-origin so the SameSite=Strict cookie just works.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:4000' } },
});
