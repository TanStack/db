// Fails the build when a module whose source starts with 'use client' loses the
// directive in a published module. Next.js App Router reads the directive from
// the first statement of each module, so a dropped or moved directive breaks
// server-component imports without a type or unit-test failure.
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, parse } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDirectory = fileURLToPath(new URL(`../`, import.meta.url))
const sourceDirectory = join(packageDirectory, `src`)
const directive = /^(['"])use client\1;?$/

// The first statement after any leading whitespace, line comments, and block
// comments (a license banner or a file header may come first).
function firstStatement(text) {
  let rest = text
  for (;;) {
    rest = rest.replace(/^\s+/, ``)
    if (rest.startsWith(`//`)) {
      const end = rest.indexOf(`\n`)
      if (end < 0) return ``
      rest = rest.slice(end + 1)
    } else if (rest.startsWith(`/*`)) {
      const end = rest.indexOf(`*/`)
      if (end < 0) return ``
      rest = rest.slice(end + 2)
    } else {
      return rest.split(`\n`)[0].trim()
    }
  }
}

const failures = []
let checked = 0
// Every module under src/, including nested directories.
for (const file of readdirSync(sourceDirectory, { recursive: true })) {
  if (!/\.tsx?$/.test(file) || file.endsWith(`.d.ts`)) continue
  const source = readFileSync(join(sourceDirectory, file), `utf8`)
  if (!directive.test(firstStatement(source))) continue
  const outputStem = join(dirname(file), parse(file).name)
  for (const output of [
    join(packageDirectory, `dist/esm`, `${outputStem}.js`),
    join(packageDirectory, `dist/cjs`, `${outputStem}.cjs`),
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
