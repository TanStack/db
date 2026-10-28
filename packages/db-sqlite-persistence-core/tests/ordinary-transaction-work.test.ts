// Ordinary tests for the SQLite committed-transaction fixture: a host-guard calibration
// and the public replay threshold. The law owner is ordinary-transaction-work-oracle.ts.
import { describe, expect, it } from 'vitest'
import {
  clone,
  fixture,
  insertRows,
  observe,
  transaction,
} from './ordinary-transaction-work-support'
import type { PersistedTx } from '../src'

describe('ordinary SQLite committed transaction oracle', () => {
  it('calibrates the synthetic 100-parameter host guard at its boundary', async () => {
    const host = fixture(100)
    let primary: unknown
    try {
      await host.driver.exec('CREATE TABLE cap_probe (value INTEGER)')
      const statement = (n: number) =>
        `INSERT INTO cap_probe (value) VALUES ${Array.from({ length: n }, () => '(?)').join(', ')}`
      await host.driver.run(statement(100), Array(100).fill(1))
      await expect(
        host.driver.run(statement(101), Array(101).fill(1)),
      ).rejects.toThrow('binding cap 100 exceeded: 101')
      expect(
        await host.driver.query<{ count: number }>(
          'SELECT COUNT(*) AS count FROM cap_probe',
        ),
      ).toEqual([{ count: 100 }])
    } catch (error) {
      primary = error
    }
    try {
      host.close()
    } catch (cleanup) {
      if (primary !== undefined)
        throw new AggregateError(
          [primary, cleanup],
          'primary and cleanup failed',
          { cause: primary },
        )
      throw cleanup
    }
    if (primary !== undefined) throw primary
  })

  it('rejects invalid values even when a later same-key action overwrites them', async () => {
    const host = fixture(100)
    const collectionId = 'oracle-overwritten-invalid-value'
    let primary: unknown
    try {
      await host.adapter.loadResumeSnapshot({
        kind: `eager`,
        collectionId: collectionId,
      })
      const seed = transaction('seed', 1, [
        { type: 'insert', key: 'same', value: { id: 'same' } },
      ])
      await host.adapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        seed,
      )
      const before = await observe(host.adapter, host.driver, collectionId)
      const invalid = new Date(Number.NaN)
      const candidates: Array<PersistedTx> = [
        {
          txId: 'invalid-row',
          term: 1,
          seq: 2,
          rowVersion: 2,
          truncate: true,
          mutations: [
            { type: 'insert', key: 'same', value: { invalid } },
            { type: 'insert', key: 'same', value: { id: 'same' } },
          ],
        },
        {
          txId: 'invalid-row-before-delete',
          term: 1,
          seq: 2,
          rowVersion: 2,
          truncate: true,
          mutations: [
            { type: 'insert', key: 'same', value: { invalid } },
            { type: 'delete', key: 'same', value: { id: 'same' } },
          ],
        },
        {
          txId: 'invalid-inline-metadata',
          term: 1,
          seq: 2,
          rowVersion: 2,
          truncate: true,
          mutations: [
            {
              type: 'insert',
              key: 'same',
              value: { id: 'same' },
              metadataChanged: true,
              metadata: invalid,
            },
            {
              type: 'insert',
              key: 'same',
              value: { id: 'same' },
              metadataChanged: true,
              metadata: { source: 'valid' },
            },
          ],
        },
        {
          txId: 'invalid-row-metadata',
          term: 1,
          seq: 2,
          rowVersion: 2,
          truncate: true,
          mutations: [],
          rowMetadataMutations: [
            { type: 'set', key: 'same', value: invalid },
            { type: 'delete', key: 'same' },
          ],
        },
        {
          txId: 'invalid-collection-metadata',
          term: 1,
          seq: 2,
          rowVersion: 2,
          truncate: true,
          mutations: [],
          collectionMetadataMutations: [
            { type: 'set', key: 'cursor', value: invalid },
            { type: 'delete', key: 'cursor' },
          ],
        },
        {
          txId: 'undefined-collection-metadata',
          term: 1,
          seq: 2,
          rowVersion: 2,
          truncate: true,
          mutations: [],
          collectionMetadataMutations: [
            { type: 'set', key: 'cursor', value: undefined },
            { type: 'delete', key: 'cursor' },
          ],
        },
      ]
      for (const candidate of candidates) {
        await expect(
          host.adapter.applyCommittedTx(
            { kind: `eager`, collectionId: collectionId },
            candidate,
          ),
        ).rejects.toThrow()
        expect(await observe(host.adapter, host.driver, collectionId)).toEqual(
          before,
        )
      }
    } catch (error) {
      primary = error
    }
    try {
      host.close()
    } catch (cleanup) {
      if (primary !== undefined)
        throw new AggregateError(
          [primary, cleanup],
          'primary and cleanup failed',
          { cause: primary },
        )
      throw cleanup
    }
    if (primary !== undefined) throw primary
  })

  it('preserves public replay below the threshold and full reload above it', async () => {
    for (const size of [64, 65]) {
      const host = fixture(999)
      const collectionId = `oracle-replay-${size}`
      let primary: unknown
      try {
        const candidate = clone(insertRows(size))
        candidate.collectionMetadataMutations = []
        await host.adapter.applyCommittedTx(
          { kind: `eager`, collectionId: collectionId },
          candidate,
        )
        const actual = await host.adapter.pullSince(
          { kind: `eager`, collectionId: collectionId },
          0,
        )
        if (size === 65) {
          expect(actual).toEqual({
            latestRowVersion: 1,
            requiresFullReload: true,
          })
        } else {
          expect(actual.requiresFullReload).toBe(false)
          if (actual.requiresFullReload) throw new Error('expected replay')
          expect(actual.latestRowVersion).toBe(1)
          expect([...actual.changedKeys].sort()).toEqual(
            candidate.mutations.map((change) => change.key).sort(),
          )
          expect(actual.deletedKeys).toEqual([])
          expect(actual.deltas).toEqual([
            {
              txId: candidate.txId,
              latestRowVersion: 1,
              changedRows: candidate.mutations.map((change) => ({
                key: change.key,
                value: clone(change.value),
              })),
              deletedKeys: [],
              rowMetadataMutations: clone(candidate.rowMetadataMutations ?? []),
              collectionMetadataMutations: clone(
                candidate.collectionMetadataMutations ?? [],
              ),
            },
          ])
        }
      } catch (error) {
        primary = error
      }
      try {
        host.close()
      } catch (cleanup) {
        if (primary !== undefined)
          throw new AggregateError(
            [primary, cleanup],
            'primary and cleanup failed',
            { cause: primary },
          )
        throw cleanup
      }
      if (primary !== undefined) throw primary
    }
  })
})
