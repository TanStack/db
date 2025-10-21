import { defineConfig } from "vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import viteTsConfigPaths from "vite-tsconfig-paths"
import { nitroV2Plugin } from "@tanstack/nitro-v2-vite-plugin"
import { capsizeRadixPlugin } from "vite-plugin-capsize-radix"
import spaceGrotesk from "@capsizecss/metrics/spaceGrotesk"
import arial from "@capsizecss/metrics/arial"

const config = defineConfig({
  plugins: [
    nitroV2Plugin(),
    // this is the plugin that enables path aliases
    viteTsConfigPaths({
      projects: [`./tsconfig.json`],
    }),
    capsizeRadixPlugin({
      outputPath: `./public/capsize.css`,
      defaultFontStack: [spaceGrotesk, arial],
      headingFontStack: [spaceGrotesk, arial],
      codingFontStack: [spaceGrotesk, arial],
    }),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
