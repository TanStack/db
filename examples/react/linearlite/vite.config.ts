import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import viteTsConfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [
    TanStackRouterVite({
      routesDirectory: './src/routes',
      generatedRouteTree: './src/routeTree.gen.ts',
    }),
    react(),
    viteTsConfigPaths(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
})
