import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: ['src/*.ts', 'src/*.tsx'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    external: ['react', 'react-dom', '@tanstack/react-db', '@tanstack/db-devtools'],
    outDir: 'build/modern',
  },
  {
    entry: ['src/*.ts', 'src/*.tsx'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: false,
    external: ['react', 'react-dom', '@tanstack/react-db', '@tanstack/db-devtools'],
    outDir: 'build/legacy',
  },
])