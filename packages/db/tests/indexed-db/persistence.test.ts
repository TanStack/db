// Ordinary tests for the settled-history owner in persistence-oracle.test.ts.
// They pin legacy version-metadata semantics and reject wrong snapshots with
// literal values. The law they support is that version tokens, not wall-clock
// timestamps, order changes, and that assertRows distinguishes typed keys and
// extra fields. The model and check that the owner declares are in
// persistence-oracle.test.ts.
import { describe, expect, it } from 'vitest'
import {
  Channel,
  assertRows,
  completed,
  readStore,
  seed,
  sorted,
  withHarness,
} from './harness'
import type { Row } from './harness'

describe('settled histories', () => {
  it('rejects wrong snapshots without erasing extra fields or typed keys', () => {
    const expected = [{ id: 0, name: 'value' }]
    for (const wrong of [
      [],
      [...expected, ...expected],
      [{ id: '0', name: 'value' }],
      [{ ...expected[0]!, optional: 1 }],
    ]) {
      expect(() => assertRows(wrong, expected, 'hostile snapshot')).toThrow()
    }
    expect(sorted(expected)).toEqual(expected)
  })
})

// Version tokens detect changes; wall-clock values have no ordering authority.
// Legacy records may retain timestamps, but new writes need only a token. The
// authored row fold is identical for absent, past and future legacy timestamps.
// Restore, an ordinary write and an import must preserve this relation. The
// untouched anchor proves cleanup does not require rewriting old metadata.
for (const timestamp of [undefined, -1, Number.MAX_SAFE_INTEGER]) {
  it(`preserves legacy metadata semantics with timestamp ${timestamp}`, async () => {
    await withHarness(async (h) => {
      const initial = [
        { id: 1, name: 'before' },
        { id: 2, name: 'anchor' },
      ]
      await seed(h.db, 'items', initial)
      const metadata = {
        versionKey: 'legacy',
        ...(timestamp === undefined ? {} : { updatedAt: timestamp }),
      }
      const tx = h.db.db.transaction('_versions', 'readwrite')
      const done = completed(tx)
      for (const row of initial)
        tx.objectStore('_versions').put(metadata, ['items', row.id])
      await done
      const source = await h.open()
      const peer = await h.open('items', { db: await h.connect() })
      assertRows(source.values(), initial, 'legacy restore')
      await source
        .update(1, (row) => {
          row.name = 'after'
        })
        .when('settled')
      await Channel.deliver()
      const after = [{ id: 1, name: 'after' }, initial[1]!]
      assertRows(
        peer.values(),
        after,
        'legacy timestamp cannot suppress notification',
      )
      const versions = await readStore(h.db, '_versions')
      const changed = versions.keys.findIndex(
        (key) => JSON.stringify(key) === '["items",1]',
      )
      const untouched = versions.keys.findIndex(
        (key) => JSON.stringify(key) === '["items",2]',
      )
      expect(
        versions.rows[changed],
        'new metadata has no unused timestamp',
      ).toEqual({ versionKey: expect.any(String) })
      expect(
        versions.rows[untouched],
        'legacy anchor need not migrate',
      ).toEqual(metadata)
      assertRows(
        (await readStore<Row>(h.db, 'items')).rows,
        after,
        'legacy durable suffix',
      )
      assertRows((await h.open()).values(), after, 'mixed-format restore')
      await source.utils.importData([{ id: 3, name: 'replacement' }])
      await Channel.deliver()
      const replacementVersions = await readStore(h.db, '_versions')
      expect(replacementVersions.keys).toEqual([['items', 3]])
      expect(replacementVersions.rows).toEqual([
        { versionKey: expect.any(String) },
      ])
      assertRows(
        peer.values(),
        [{ id: 3, name: 'replacement' }],
        'legacy replacement peer',
      )
      assertRows(
        (await h.open()).values(),
        [{ id: 3, name: 'replacement' }],
        'legacy replacement restore',
      )
    })
  })
}
