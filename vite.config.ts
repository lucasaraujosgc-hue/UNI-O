import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
  },
  server: {
    allowedHosts: true, // Para resolver o erro anterior
    host: true,
    watch: {
      // Impede o Vite de monitorar a pasta de backup/sessão
      ignored: ['**/backup/**', '**/wa_auth/**'],
      usePolling: true,
    },
  },
});