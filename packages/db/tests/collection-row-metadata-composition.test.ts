/**
 * Ordinary grammar and model tests for the row metadata composition oracle.
 * They check the history grammar's size and named witnesses, and named wrong
 * answers that the model must not give. The law and its production
 * comparison live in collection-row-metadata-composition-oracle.test.ts.
 */
import { describe, expect, it } from 'vitest'
import {
  cursorKey,
  describeNested,
  describeWrite,
  expectedHeldReads,
  expectedMetadata,
  expectedNestedMetadata,
  histories,
  laterKey,
  laterMetadata,
  nestedHistories,
  rebuiltHistories,
  startMetadata,
  writeMetadata,
} from './collection-row-metadata-composition-model-oracle.js'

describe(`row metadata composition oracle`, () => {
  it(`enumerates every legal one-key history of up to three writes`, () => {
    expect(histories).toHaveLength(1457)
    const labels = new Set(
      histories.map(
        ({ start, sequence }) =>
          `${start}: ${sequence.map(describeWrite).join(`, `)}`,
      ),
    )
    expect(labels.size).toBe(histories.length)
    // Named witnesses for each write rule must remain in the grammar.
    for (const witness of [
      `present-with-metadata: delete+metadata`,
      `absent: set, insert`,
      `absent: insert+metadata, set`,
      `present-with-metadata: update`,
      `present-without-metadata: delete, set`,
      `present-with-metadata: reinsert`,
      `absent: insert+metadata, reinsert`,
    ])
      expect(labels).toContain(witness)
    expect(labels).not.toContain(`absent: update`)
    expect(labels).not.toContain(`absent: reinsert`)
    expect(labels).not.toContain(`present-with-metadata: insert`)
  })

  it(`rejects named wrong answers in the model`, () => {
    // A delete that carried metadata keeps none.
    expect(
      expectedMetadata(`present-with-metadata`, [
        { kind: `delete`, metadata: true },
      ]),
    ).toBeUndefined()
    // A later insert without metadata clears an explicit set.
    expect(
      expectedMetadata(`absent`, [
        { kind: `set` },
        { kind: `insert`, metadata: false },
      ]),
    ).toBeUndefined()
    // An equal re-insert without metadata keeps the current value.
    expect(
      expectedMetadata(`present-with-metadata`, [
        { kind: `reinsert`, metadata: false },
      ]),
    ).toEqual(startMetadata)
    // An update without metadata keeps the current value.
    expect(
      expectedMetadata(`present-with-metadata`, [
        { kind: `update`, metadata: false },
      ]),
    ).toEqual(startMetadata)
  })

  it(`enumerates rebuilt histories against every earlier write`, () => {
    // 1457 after a key-2 update, plus 310 after a key-1 write.
    expect(rebuiltHistories).toHaveLength(1767)
    expect(
      rebuiltHistories.some(
        ({ earlier, sequence }) =>
          earlier.key === 1 &&
          earlier.kind === `delete` &&
          sequence[0]?.kind === `insert`,
      ),
    ).toBe(true)
  })

  it(`enumerates nested histories for every nested write`, () => {
    const labels = new Set(nestedHistories.map(describeNested))
    // 275 sequences for each of the seven nested variants.
    expect(nestedHistories).toHaveLength(1925)
    expect(labels.size).toBe(nestedHistories.length)
    // Each variant must keep the writes that reclassify or reorder positions.
    for (const witness of [
      `present-with-metadata, nested delete: set, insert`,
      `absent, nested insert: set, insert`,
      `absent, nested seed: set, insert`,
      `absent, nested insert+set: insert+metadata`,
      `present-without-metadata, nested delete: insert, set, delete`,
      `absent, nested insert: set, truncate, insert`,
      `absent, nested seed: insert, update, set`,
    ])
      expect(labels).toContain(witness)
    // An update needs the row present where T1 writes it and where it applies.
    expect(labels).not.toContain(`absent, nested insert: update`)
    expect(labels).not.toContain(`present-with-metadata, nested delete: update`)
    // A set, then an insert that is now an insert: the insert clears it.
    expect(
      expectedNestedMetadata({
        start: `present-with-metadata`,
        nested: `delete`,
        nestedSet: false,
        sequence: [{ kind: `set` }, { kind: `insert`, metadata: false }],
      }),
    ).toBeUndefined()
    // A set, then an insert that is now an equal re-insert: the set holds.
    expect(
      expectedNestedMetadata({
        start: `absent`,
        nested: `insert`,
        nestedSet: false,
        sequence: [{ kind: `set` }, { kind: `insert`, metadata: false }],
      }),
    ).toEqual(writeMetadata(0))
    // T1's insert replaces the seeded row, so it clears T1's earlier set.
    expect(
      expectedNestedMetadata({
        start: `absent`,
        nested: `seed`,
        nestedSet: false,
        sequence: [{ kind: `set` }, { kind: `insert`, metadata: false }],
      }),
    ).toBeUndefined()
    // T1 applies after the nested set, so T1's later write wins.
    expect(
      expectedNestedMetadata({
        start: `absent`,
        nested: `insert`,
        nestedSet: true,
        sequence: [{ kind: `insert`, metadata: true }],
      }),
    ).toEqual(writeMetadata(0))
  })

  it(`rejects named wrong answers in the held-window model`, () => {
    // Truncate keeps collection metadata, and an earlier set survives T2.
    expect(
      expectedHeldReads(
        `present-with-metadata`,
        [{ kind: `set` }, { kind: `truncate` }],
        `empty`,
      ),
    ).toEqual({
      row: undefined,
      cursor: writeMetadata(0),
      list: [
        { key: cursorKey, value: writeMetadata(0) },
        { key: laterKey, value: laterMetadata },
      ],
    })
    // An open truncate hides row metadata, not the cursor.
    expect(
      expectedHeldReads(`absent`, [{ kind: `set` }], `truncated`),
    ).toMatchObject({ row: undefined, cursor: writeMetadata(0) })
  })
})
