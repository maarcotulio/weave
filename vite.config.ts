import { defineConfig, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_'],
  build: { target: 'es2022' },
  test: { exclude: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/coverage/**', '**/.worktrees/**'] }
} as UserConfig & { test: { exclude: string[] } });
