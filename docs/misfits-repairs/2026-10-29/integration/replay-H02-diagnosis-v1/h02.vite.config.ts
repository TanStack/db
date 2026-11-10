import { mergeConfig } from 'vitest/config'
import original from './vite.config.ts'
import { fileURLToPath } from 'node:url'
export default mergeConfig(original, {
  resolve: { alias: [
    { find: /^@tanstack\/db$/, replacement: fileURLToPath(new URL('../db/src/index.ts', import.meta.url)) },
    { find: /^@tanstack\/db-ivm$/, replacement: fileURLToPath(new URL('../db-ivm/src/index.ts', import.meta.url)) },
  ] },
})
