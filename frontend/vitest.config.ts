import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    projects: [
      {
        plugins: [react()],
        resolve: { alias: { '@': path.resolve(__dirname, './src') } },
        test: {
          name: 'api',
          globals: true,
          environment: 'node',
          setupFiles: ['./src/test/setup.ts'],
          include: ['src/app/api/**/*.test.{ts,tsx}'],
        },
      },
      {
        plugins: [react()],
        resolve: { alias: { '@': path.resolve(__dirname, './src') } },
        test: {
          name: 'dom',
          globals: true,
          environment: 'jsdom',
          setupFiles: ['./src/test/setup.ts'],
          include: ['src/**/*.test.{ts,tsx}'],
          exclude: ['src/app/api/**/*.test.{ts,tsx}', '**/node_modules/**'],
        },
      },
    ],
  },
});
