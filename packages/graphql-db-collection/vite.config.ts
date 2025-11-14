import { defineConfig } from "vite"
import { tanstackViteConfig } from "@tanstack/config/vite"

export default defineConfig({
  ...tanstackViteConfig({
    entry: `./src/index.ts`,
    srcDir: `./src`,
  }),
})
