/**
 * Ordinary reference-model tests for the DbClient hydration authority oracle.
 * They fold fixed histories through the reference and do not run production;
 * the law and its production comparison live in
 * db-client-hydration-authority-oracle.test.ts.
 */
import { describe, expect, it } from 'vitest'
import {
  adapterAction,
  cases,
  hydrationRows,
  initialRows,
  newKey,
  peer,
  referenceRows,
  target,
} from './db-client-hydration-authority-model-oracle.js'
import type {
  ObservedRow,
  SeedRow,
} from './db-client-hydration-authority-model-oracle.js'

describe(`DbClient hydration authority reference`, () => {
  // Seeds for the metadata law. Seed A carries `seeded` and metadata; seed B
  // carries neither `seeded` nor metadata unless a test says otherwise.
  const seedA: SeedRow = {
    value: { id: target, name: `seed-a`, seeded: `x` },
    metadata: { source: `seed-a` },
  }
  const seedB: SeedRow = {
    value: { id: target, name: `seed-b` },
    metadata: { source: `seed-b` },
  }
  const targetOf = (
    rows: ReadonlyArray<ObservedRow>,
  ): ObservedRow | undefined => rows.find((entry) => entry.id === target)
  const hydrate = (rows: ReadonlyArray<SeedRow>) => ({
    kind: `hydrate` as const,
    rows,
  })

  it(`reaches applied delete and truncate with late hydration`, () => {
    expect(cases).toContainEqual({
      decisions: [`delete`],
      label: `delete`,
      order: `after`,
      rowUpdateMode: `partial`,
    })
    expect(cases).toContainEqual({
      decisions: [`truncate`],
      label: `truncate`,
      order: `after`,
      rowUpdateMode: `partial`,
    })
    expect(
      referenceRows(
        initialRows,
        [adapterAction(`delete`), hydrate(hydrationRows(`after`))],
        `partial`,
      ),
    ).toEqual([
      {
        id: peer,
        row: { id: peer, name: `after-peer` },
        metadata: { source: `after-hydration` },
      },
      {
        id: newKey,
        row: { id: newKey, name: `after-new` },
        metadata: { source: `after-hydration` },
      },
    ])
  })

  it(`reference folds the D5 rules over fixed histories`, () => {
    const before = hydrate(hydrationRows(`before`))
    const after = hydrate(hydrationRows(`after`))

    // An insert replaces the seed's row and clears its metadata.
    expect(
      targetOf(
        referenceRows(
          initialRows,
          [before, adapterAction(`insert`)],
          `partial`,
        ),
      ),
    ).toEqual({
      id: target,
      row: { id: target, name: `adapter-insert` },
      metadata: undefined,
    })
    // A partial update merges over the seed and keeps its unnamed field and metadata.
    expect(
      targetOf(
        referenceRows(
          initialRows,
          [before, adapterAction(`update`)],
          `partial`,
        ),
      ),
    ).toEqual({
      id: target,
      row: { id: target, name: `adapter-update`, seeded: `before` },
      metadata: { source: `before-hydration` },
    })
    // An update that does not name metadata leaves the metadata open to a later seed.
    expect(
      targetOf(
        referenceRows(initialRows, [adapterAction(`update`), after], `partial`),
      ),
    ).toEqual({
      id: target,
      row: { id: target, name: `adapter-update`, seeded: `initial` },
      metadata: { source: `after-hydration` },
    })
    // An update that names metadata fixes it against a later seed.
    expect(
      targetOf(
        referenceRows(
          initialRows,
          [adapterAction(`update+metadata`), after],
          `partial`,
        ),
      ),
    ).toEqual({
      id: target,
      row: { id: target, name: `adapter-update`, seeded: `initial` },
      metadata: { source: `adapter-update` },
    })
    // A metadata-only write fixes the metadata and leaves the row to a later seed.
    expect(
      targetOf(
        referenceRows(
          initialRows,
          [adapterAction(`metadata`), after],
          `partial`,
        ),
      ),
    ).toEqual({
      id: target,
      row: { id: target, name: `after-target` },
      metadata: { source: `adapter-metadata` },
    })
    // The latest seed wins for a key no adapter write has written.
    expect(
      referenceRows(initialRows, [before, after], `partial`).find(
        (entry) => entry.id === peer,
      ),
    ).toEqual({
      id: peer,
      row: { id: peer, name: `after-peer` },
      metadata: { source: `after-hydration` },
    })
  })

  it(`reference keeps the metadata of an equal re-insert of a source-written row`, () => {
    expect(
      targetOf(
        referenceRows(
          [seedA],
          [adapterAction(`insert+metadata`), adapterAction(`insert`)],
          `partial`,
        ),
      ),
    ).toEqual({
      id: target,
      row: { id: target, name: `adapter-insert` },
      metadata: { source: `adapter-insert` },
    })
    // The clear applies only over seed-only rows, so an unequal re-insert is
    // outside the grammar and the reference refuses it.
    expect(() =>
      referenceRows(
        [seedA],
        [
          adapterAction(`insert`),
          { kind: `adapter`, op: `insert`, row: { id: target, name: `other` } },
        ],
        `partial`,
      ),
    ).toThrow(`insert over a source-written row must re-insert it`)
  })

  it(`reference lets seed B supply metadata when a partial update wrote only row data`, () => {
    // Seed A's `seeded` survives the partial merge; B supplies only the metadata.
    expect(
      targetOf(
        referenceRows(
          [seedA],
          [adapterAction(`update`), hydrate([seedB])],
          `partial`,
        ),
      ),
    ).toEqual({
      id: target,
      row: { id: target, name: `adapter-update`, seeded: `x` },
      metadata: { source: `seed-b` },
    })
    // The update's metadata is the source's, so B's metadata is ignored.
    expect(
      targetOf(
        referenceRows(
          [seedA],
          [adapterAction(`update+metadata`), hydrate([seedB])],
          `partial`,
        ),
      ),
    ).toEqual({
      id: target,
      row: { id: target, name: `adapter-update`, seeded: `x` },
      metadata: { source: `adapter-update` },
    })
  })

  it(`reference merges a partial update over the later seed when both seeds arrive first`, () => {
    // Seed B replaces A's row whole, so the update's merge base has no `seeded`.
    expect(
      targetOf(
        referenceRows(
          [seedA],
          [hydrate([seedB]), adapterAction(`update`)],
          `partial`,
        ),
      ),
    ).toEqual({
      id: target,
      row: { id: target, name: `adapter-update` },
      metadata: { source: `seed-b` },
    })
  })

  it(`reference leaves metadata absent when the latest seed names none`, () => {
    expect(
      targetOf(
        referenceRows([seedA], [hydrate([{ value: seedB.value }])], `partial`),
      ),
    ).toEqual({
      id: target,
      row: { id: target, name: `seed-b` },
      metadata: undefined,
    })
  })

  it(`reference holds a metadata-only write against a later seed`, () => {
    expect(
      targetOf(
        referenceRows(
          [seedA],
          [adapterAction(`metadata`), hydrate([seedB])],
          `partial`,
        ),
      ),
    ).toEqual({
      id: target,
      row: { id: target, name: `seed-b` },
      metadata: { source: `adapter-metadata` },
    })
  })
})
