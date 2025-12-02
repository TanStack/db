import { defineConfig } from "vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteTsConfigPaths from "vite-tsconfig-paths"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"

const config = defineConfig({
  plugins: [
    viteTsConfigPaths({
      projects: [`./tsconfig.json`],
    }),
    tailwindcss(),
    tanstackStart({
      srcDirectory: `src`,
      start: { entry: `./start.tsx` },
      spa: {
        enabled: true,
      },
    }),
    react(),
  ],
})

export default config
