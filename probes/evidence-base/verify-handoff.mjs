import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const research = resolve(here, '../endpoints/design/evidence-guarantees')
const trip = resolve(research, '../field-trip-optimistic-coherence')
const json = async (path) => JSON.parse(await readFile(path, 'utf8'))
const hash = async (path) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex')

for (const directory of ['base-grammar', 'base-grammar/revisions/v2']) {
  const root = resolve(research, directory)
  for (const [file, expected] of Object.entries(
    (await json(resolve(root, 'freeze.json'))).files,
  )) {
    assert.equal(
      await hash(resolve(root, file)),
      expected,
      `${directory}/${file}`,
    )
  }
}
const snapshots = await json(resolve(research, 'base-stress/manifest.json'))
for (const entry of snapshots.files) {
  assert.equal(
    await hash(resolve(research, 'base-stress', entry.snapshot)),
    entry.sha256,
    entry.snapshot,
  )
}
const portable = await json(resolve(research, 'portable-sources/manifest.json'))
const remap = new Map()
for (const entry of portable.files) {
  const path = resolve(research, 'portable-sources', entry.local)
  assert.equal(await hash(path), entry.sha256, entry.local)
  remap.set(entry.original, path)
}
const sources = await json(
  resolve(research, 'structural-recombine-sources.json'),
)
for (const entry of sources.sources) {
  const path = remap.get(entry.path) ?? resolve(research, entry.path)
  assert.equal(await hash(path), entry.sha256, entry.id)
}
const events = (await readFile(resolve(trip, 'field_log.jsonl'), 'utf8'))
  .trim()
  .split('\n')
  .map(JSON.parse)
events.forEach((event, index) => assert.equal(event.eventId, index + 1))
const recorded = new Map()
for (const event of events.filter(
  (event) => event.type === 'comment.recorded',
)) {
  const text = event.payload.text.trim()
  recorded.set(text, (recorded.get(text) ?? 0) + 1)
}
const archive = await json(
  resolve(trip, 'sources/user-comments-through-evidence-repair.json'),
)
assert.equal(archive.comments.length, archive.count)
for (const [index, comment] of archive.comments.entries()) {
  assert.equal(comment.ordinal, index + 1)
  assert.ok(
    recorded.get(comment.text) > 0,
    `Missing user comment ${comment.ordinal}`,
  )
  recorded.set(comment.text, recorded.get(comment.text) - 1)
}
console.log(
  `Verified v1/v2 freezes, ${snapshots.files.length} audit snapshots, ${portable.files.length} portable sources, ${sources.sources.length} recombination sources, and all ${archive.count} user requests in ${events.length} log events.`,
)
