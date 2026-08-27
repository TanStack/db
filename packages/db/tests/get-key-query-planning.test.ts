import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { currentStateAsChanges } from '../src/collection/change-events.js'
import { Func, PropRef, Value } from '../src/query/ir.js'

describe(`getKey query planning`, () => {
  it(`does not treat arbitrary getKey code as query field metadata`, async () => {
    type Row = { id: string; fallback: string }
    let getKeyCalls = 0
    const collection = createCollection<Row>({
      id: `conditional-get-key-query-planning`,
      getKey: (row) => {
        getKeyCalls++
        return row.id === `special` ? row.fallback : row.id
      },
      autoIndex: `off`,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          write({
            type: `insert`,
            value: { id: `special`, fallback: `actual-key` },
          })
          commit()
          markReady()
        },
      },
    })

    try {
      await collection.stateWhenReady()
      const callsAfterSync = getKeyCalls
      const where = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`special`),
      ])

      expect(
        currentStateAsChanges(collection, { where, optimizedOnly: true }),
      ).toBeUndefined()
      expect(getKeyCalls).toBe(callsAfterSync)
      expect(
        currentStateAsChanges(collection, { where })?.map(
          (change) => change.key,
        ),
      ).toEqual([`actual-key`])
      expect(getKeyCalls).toBe(callsAfterSync)
    } finally {
      await collection.cleanup()
    }
  })
})
