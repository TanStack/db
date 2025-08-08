import { defineConfig } from "vite"
import solid from "vite-plugin-solid"
import dts from "vite-plugin-dts"

export default defineConfig({
  plugins: [
    solid(),
    dts({
      insertTypesEntry: true,
      include: [`src/**/*`],
      exclude: [`src/**/*.test.*`, `src/__tests__/**/*`],
    }),
  ],
  build: {
    target: `esnext`,
    lib: {
      entry: `src/index.ts`,
      formats: [`es`, `cjs`],
      fileName: (format) => `index.${format === `es` ? `js` : `cjs`}`,
    },
    rollupOptions: {
      external: [
        `solid-js`,
        `solid-js/web`,
        `@tanstack/db`,
        `@tanstack/solid-db`,
      ],
    },
  },
})
