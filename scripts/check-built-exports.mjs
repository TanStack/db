/**
 * Run from a package directory after its build. Fresh Node consumers load the
 * package's declared root import and require exports; optional arguments name
 * function exports that both consumers must receive.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const { name } = JSON.parse(readFileSync(`package.json`, `utf8`))
if (typeof name !== `string` || !name)
  throw new Error(`The built package must have a name.`)
const functions = process.argv.slice(2)
for (const mode of [`esm`, `cjs`]) {
  const load =
    mode === `esm`
      ? `await import(${JSON.stringify(name)})`
      : `require(${JSON.stringify(name)})`
  const source = `
const api = ${load};
for (const name of ${JSON.stringify(functions)}) {
  if (typeof api[name] !== 'function') throw new Error('Missing built function export: ' + name);
}
`
  execFileSync(
    process.execPath,
    [...(mode === `esm` ? [`--input-type=module`] : []), `--eval`, source],
    { cwd: process.cwd(), stdio: `inherit` },
  )
}
console.log(`Built ESM and CommonJS exports loaded: ${name}`)
