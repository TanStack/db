import { defineConfig } from "tsup"

export default defineConfig([
  // Build the core logic without JSX
  {
    entry: ["src/core.ts"],
    format: ["esm", "cjs"],
    dts: false,
    sourcemap: true,
    clean: true,
    external: ["@tanstack/db"],
  },
  // Build SolidJS components separately
  {
    entry: ["src/solid.ts"],
    format: ["esm", "cjs"],
    dts: false,
    sourcemap: true,
    clean: false,
    external: ["solid-js", "solid-js/web", "@tanstack/db"],
    esbuildOptions(options) {
      options.jsx = "preserve"
      options.jsxImportSource = "solid-js"
    },
  }
])