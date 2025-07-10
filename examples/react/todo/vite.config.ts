import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteTsConfigPaths from "vite-tsconfig-paths"

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    viteTsConfigPaths({
      projects: [`./tsconfig.json`],
    }),
    tailwindcss(),
    tanstackStart({
      customViteReactPlugin: true,
      spa: {
        enabled: true,
      },
    }),
    react(),
  ],
})
