// Fails the build when a module whose source starts with 'use client' loses the
// directive in a published module. Next.js App Router reads the directive from
// the first statement of each module, so a dropped or moved directive breaks
// server-component imports without a type or unit-test failure.
import { readdirSync, readFileSync } from 'node:fs'
import { basename, join, parse } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDirectory = fileURLToPath(new URL(`../`, import.meta.url))
const sourceDirectory = join(packageDirectory, `src`)
const directive = /^(['"])use client\1;?$/

function firstStatement(text) {
  // Skip blank lines and comments that come before the first statement.
  for (const line of text.split(`\n`)) {
    const trimmed = line.trim()
    if (trimmed === `` || trimmed.startsWith(`//`)) continue
    return trimmed
  }
  return ``
}

const failures = []
let checked = 0
for (const file of readdirSync(sourceDirectory)) {
  if (!/\.tsx?$/.test(file) || file.endsWith(`.d.ts`)) continue
  const source = readFileSync(join(sourceDirectory, file), `utf8`)
  if (!directive.test(firstStatement(source))) continue
  const name = parse(basename(file)).name
  for (const output of [
    join(packageDirectory, `dist/esm`, `${name}.js`),
    join(packageDirectory, `dist/cjs`, `${name}.cjs`),
  ]) {
    checked++
    const built = readFileSync(output, `utf8`)
    if (!directive.test(firstStatement(built))) {
      failures.push(`${output} lost its 'use client' directive`)
    }
  }
}

if (checked === 0) {
  throw new Error(`no 'use client' modules were found in ${sourceDirectory}`)
}
if (failures.length > 0) {
  console.error(failures.join(`\n`))
  process.exit(1)
}
console.log(`'use client' kept in ${checked} published modules`)
