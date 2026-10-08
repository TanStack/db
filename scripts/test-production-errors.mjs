// Consumer-build contract for production error codes: a production build of
// the public API carries no full error message text, and a development build
// keeps it. Authority: packages/db/tests/production-error-messages-oracle.test.ts,
// which owns the message format. This check owns erasure: it bundles the
// built packages/db/dist the way a consumer's bundler would, with
// `process.env.NODE_ENV` defined, and searches the output for one distinctive
// literal from each coded class's frozen development message.
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { assertDbDistFresh } from '../packages/db/scripts/assert-dist-fresh.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tests = path.join(root, 'packages/db/tests')
const builtEntry = await assertDbDistFresh(root)
const codes = JSON.parse(
  await readFile(path.join(tests, 'fixtures/error-codes.json'), 'utf8'),
)
const messages = JSON.parse(
  await readFile(path.join(tests, 'fixtures/error-messages.json'), 'utf8'),
)

const sites = JSON.parse(
  await readFile(path.join(tests, 'fixtures/error-site-messages.json'), 'utf8'),
)
const readSource = (file) =>
  readFile(path.join(root, 'packages/db/src', file), 'utf8')
// Error classes live in errors.ts and in a few feature modules.
const classSource = (
  await Promise.all(
    (await readdir(path.join(root, 'packages/db/src'), { recursive: true }))
      .filter((file) => file.endsWith('.ts'))
      .map(readSource),
  )
).join('\n')

/**
 * The longest stretch of a message that the source holds verbatim, so it is
 * template text rather than a sample input's value.
 */
function distinctiveLiteral(message, source, avoid = ``) {
  let best = ``
  for (const piece of message.split(/"[^"]*"|`[^`]*`|\$\{[^}?]*\??|\}|\n/)) {
    for (let start = 0; start + best.length < piece.length; start++) {
      let end = start + best.length + 1
      while (end <= piece.length && source.includes(piece.slice(start, end))) {
        if (
          end - start > best.length &&
          !avoid.includes(piece.slice(start, end))
        )
          best = piece.slice(start, end)
        if (best.length === 40) return best.trim()
        end++
      }
    }
  }
  return best.trim()
}

// Each entry: name, the text its literal comes from, and the source file that
// must hold the literal verbatim.
const entries = [
  ...Object.keys(codes).map((name) => [name, messages[name][0], classSource]),
  ...(await Promise.all(
    Object.entries(sites).map(async ([code, { file, literals }]) => [
      `error ${code} (${file})`,
      literals.join('\n'),
      await readSource(file),
    ]),
  )),
]
// These errors share all of their text with text that every build keeps, so no
// literal distinguishes them. The oracle still checks their guard.
const sharedWithWarnings = new Set([
  // the IndexedDB request-failure fallback in indexed-db-wrapper.ts
  'error 170 (utils/error.ts)',
])
const coded = entries.filter(([name]) => !sharedWithWarnings.has(name))
assert.equal(
  entries.length - coded.length,
  sharedWithWarnings.size,
  'stale sharedWithWarnings entry',
)

// collection/config-errors.ts is development-only: ESM production bundles
// erase validateCollectionConfig and every diagnostic it throws. A CommonJS
// bundle cannot drop the module, so it keeps that text, as main does.
const developmentOnly = [
  'collection/config-errors.ts',
  'Collection requires a "getKey" function in the config.',
]

// Developer hints, one literal per guarded region: production bundles drop
// every region, in both formats, because the guard folds inside each function.
const regions = JSON.parse(
  await readFile(
    path.join(tests, 'fixtures/development-only-messages.json'),
    'utf8',
  ),
)
const hints = await Promise.all(
  regions.map(async ({ file, literals }, region) => [
    `development-only region ${region} (${file})`,
    literals.join('\n'),
    await readSource(file),
  ]),
)

/**
 * One literal per entry, unique across entries, so one entry's copy cannot
 * keep another entry's check green. Entries whose first choice collides pick
 * again, avoiding each other's text. An entry with no text of its own, such as
 * one message thrown at several sites, keeps its first choice and is shared.
 */
const shared = new Set()
function chooseLiterals(list) {
  const first = list.map(([, text, source]) => distinctiveLiteral(text, source))
  const chosen = [...first]
  for (let round = 0; round < 3; round++) {
    const owners = new Map()
    chosen.forEach((literal, index) =>
      owners.set(literal, [...(owners.get(literal) ?? []), index]),
    )
    const collisions = [...owners.values()].filter((group) => group.length > 1)
    if (!collisions.length) break
    for (const group of collisions)
      for (const index of group) {
        const [, text, source] = list[index]
        const avoid = group
          .filter((other) => other !== index)
          .map((other) => list[other][1])
          .join('\n')
        const own = distinctiveLiteral(text, source, avoid)
        if (own.length >= 12) chosen[index] = own
        else shared.add(list[index][0])
      }
  }
  return list.map(([name], index) => [name, chosen[index]])
}

const checked = chooseLiterals([...coded, ...hints])
const seen = new Map()
for (const [name, literal] of checked) {
  assert.ok(
    shared.has(name) || !seen.has(literal),
    `${name} and ${seen.get(literal)} share the literal ${JSON.stringify(literal)}`,
  )
  seen.set(literal, name)
}
const short = checked.filter(([, literal]) => literal.length < 12)
assert.deepEqual(short, [], 'coded errors without a distinctive literal')

// `require` consumers get the CommonJS build, so check it too.
const cjsEntry = path.join(path.dirname(builtEntry), '../cjs/index.cjs')

async function bundle(nodeEnv, entry = builtEntry) {
  const result = await build({
    stdin: {
      contents: `export * from ${JSON.stringify(entry)}`,
      resolveDir: root,
    },
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
    logLevel: 'error',
    define: { 'process.env.NODE_ENV': JSON.stringify(nodeEnv) },
    nodePaths: [path.join(root, 'packages/db/node_modules')],
  })
  return result.outputFiles[0].text
}

for (const [format, entry, expected] of [
  ['ESM', builtEntry, [...checked, developmentOnly]],
  ['CommonJS', cjsEntry, checked],
]) {
  const production = await bundle('production', entry)
  const development = await bundle('development', entry)
  const kept = expected.filter(([, literal]) => production.includes(literal))
  const missing = expected.filter(
    ([, literal]) => !development.includes(literal),
  )
  assert.deepEqual(kept, [], `${format} production build kept full error text`)
  assert.deepEqual(
    missing,
    [],
    `${format} development build lost full error text`,
  )
}
console.log(
  `production error text: ${checked.length} literals (${shared.size} shared) erased in production and kept in development, in ESM and CommonJS builds`,
)
