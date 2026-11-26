/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Base path differs by host:
//  • GitHub Pages serves the build under /apex/ (project page), so assets must be /apex/…
//  • Cloudflare (Workers Builds sets WORKERS_CI=1) and Vercel (sets VERCEL=1) serve it at the domain root, so
//    assets must be /…
//  • the dev server always runs at /
// One build config, correct on each. Override with APEX_BASE if you host it somewhere else.
const atRoot = !!(process.env.WORKERS_CI || process.env.VERCEL);
const buildBase = process.env.APEX_BASE ?? (atRoot ? '/' : '/apex/');
export default defineConfig(({ command }) => ({
  base: command === 'build' ? buildBase : '/',
  plugins: [react()],
  test: {
    // core/protocol tests are pure logic and need no DOM; view tests can opt into jsdom per-file
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // a few property tests fuzz tens of thousands of cases (e.g. bresenham over 50k lines) and run ~10s;
    // give them headroom above vitest's 5s default so they don't flake on slower runners.
    testTimeout: 20000,
  },
}));
