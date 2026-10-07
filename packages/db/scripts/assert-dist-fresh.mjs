// Checks that packages/db/dist comes from the current build pipeline. The
// built entry must be at least as new as every source file, the mangle cache,
// and the package's build configuration. Lanes that test dist call this so
// they never judge output from an older build.
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'

/**
 * @param {string} root repository root
 * @returns {Promise<string>} the built ESM entry
 */
export async function assertDbDistFresh(root) {
  const packageDir = path.join(root, 'packages/db')
  const builtEntry = path.join(packageDir, 'dist/esm/index.js')
  const built = await stat(builtEntry).catch((error) => {
    if (error.code !== 'ENOENT') throw error
    return null
  })
  if (!built) throw new Error('Build @tanstack/db before testing its dist')
  const inputs = [
    ...[
      'mangle-cache.json',
      'vite.config.ts',
      'package.json',
      'tsconfig.json',
    ].map((file) => path.join(packageDir, file)),
    ...(await readdir(path.join(packageDir, 'src'), { recursive: true }))
      .filter((file) => file.endsWith('.ts'))
      .map((file) => path.join(packageDir, 'src', file)),
  ]
  for (const input of inputs) {
    const { mtimeMs } = await stat(input)
    if (mtimeMs > built.mtimeMs)
      throw new Error(
        `packages/db/dist is older than ${path.relative(root, input)}; rebuild @tanstack/db`,
      )
  }
  return builtEntry
}
