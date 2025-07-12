import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: 'build',
  external: ['solid-js', 'solid-js/web', '@tanstack/db'],
  esbuildOptions(options) {
    // Use SolidJS-compatible JSX settings
    options.jsx = 'automatic'
    options.jsxImportSource = 'solid-js'
    // Add SolidJS runtime helpers
    options.banner = {
      js: 'import{template as _$template,delegateEvents as _$delegateEvents,addEventListener as _$addEventListener,classList as _$classList,style as _$style,setAttribute as _$setAttribute,setProperty as _$setProperty,className as _$className,textContent as _$textContent,innerHTML as _$innerHTML}from"solid-js/web";'
    }
  },
})