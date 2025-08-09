import { defineConfig } from "vite"
import solid from "vite-plugin-solid"
import tailwindcss from "@tailwindcss/vite"
import { tanstackStart } from "@tanstack/solid-start/plugin/vite"
import viteTsConfigPaths from "vite-tsconfig-paths"

// https://vitejs.dev/config/
export default defineConfig({
  ssr: { external: [`drizzle-orm`] },
  plugins: [
    viteTsConfigPaths({
      projects: [`./tsconfig.json`],
    }),
    tailwindcss(),
    tanstackStart({
      customViteSolidPlugin: true,
      spa: {
        prerender: { enabled: false },
        enabled: true,
      },
    }),
    solid({ ssr: true }),
  ],
})
