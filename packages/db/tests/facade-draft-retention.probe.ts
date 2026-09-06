// Run manually: node --expose-gc --import tsx tests/facade-draft-retention.probe.ts
// This probes reachability, not total application heap size or GC latency.
import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import { D2, MultiSet } from '@tanstack/db-ivm'
import { BucketFacadeAdapter } from '../src/query/live/bucket-facade-adapter.js'
import { BUCKET_FACADE_REF } from '../src/query/live/materialized-pipeline.js'
import type { Collection } from '../src/collection/index.js'
import type {
  BucketFacadeRef,
  BucketRow,
} from '../src/query/live/materialized-pipeline.js'

const gc = globalThis.gc
if (!gc) throw new Error(`Run this probe with --expose-gc`)

function capture(
  released: boolean,
  holder: `view` | `method`,
  rollback: boolean,
) {
  const graph = new D2()
  const rows = graph.newInput<[string, BucketRow]>()
  const activeBuckets = graph.newInput<[string, true]>()
  const adapter = new BucketFacadeAdapter(
    `retention-probe`,
    [{ edgeId: `children`, rows, activeBuckets, hasOrderBy: false }],
    () => {},
  )
  graph.finalize()
  const value = { id: 1, payload: new ArrayBuffer(1024 * 1024) }
  const bucketKey = `group`
  activeBuckets.sendData(new MultiSet([[[bucketKey, true], 1]]))
  rows.sendData(
    new MultiSet([
      [
        [
          bucketKey,
          {
            publicKey: 1,
            value,
            order: undefined,
          },
        ],
        1,
      ],
    ]),
  )
  graph.run()
  const ref: BucketFacadeRef = {
    [BUCKET_FACADE_REF]: { edgeId: `children`, bucketKey },
  }
  const view = adapter.resolveDraft(ref) as unknown as Collection<
    typeof value,
    number
  >
  assert.equal(view.get(1)?.id, 1)
  const retained = holder === `view` ? view : view.get.bind(view)
  const publication = adapter.flush()
  if (rollback) publication.rollback()
  else publication.publish()
  if (released) adapter.publishDrafts()
  adapter.cleanup()
  return { retained, value: new WeakRef(value), adapter: new WeakRef(adapter) }
}

const cells = [false, true].flatMap((released) =>
  ([`view`, `method`] as const).flatMap((holder) =>
    [false, true].map((rollback) => ({ released, holder, rollback })),
  ),
)
const results = cells.map((cell) => ({
  ...cell,
  samples: Array.from({ length: 10 }, () =>
    capture(cell.released, cell.holder, cell.rollback),
  ),
}))

// WeakRef targets stay alive through the creating job. Cross job boundaries
// before forcing collection and avoid dereferencing targets inside this loop.
for (let turn = 0; turn < 5; turn++) {
  await setImmediate()
  gc()
}
await setImmediate()

const report = results.map(({ released, holder, rollback, samples }) => {
  const retainedValues = samples.filter(
    (sample) => sample.value.deref() !== undefined,
  ).length
  const retainedAdapters = samples.filter(
    (sample) => sample.adapter.deref() !== undefined,
  ).length
  // Unreleased snapshots are the positive control: this probe must detect them.
  assert.equal(retainedValues, released ? 0 : samples.length)
  assert.equal(retainedAdapters, 0)
  assert.equal(samples.length, 10)
  // Keep each public handle or captured method observably reachable to the end.
  for (const { retained } of samples) {
    const row = typeof retained === `function` ? retained(1) : retained.get(1)
    assert.equal(row?.id, released ? undefined : 1)
  }
  return {
    released,
    holder,
    rollback,
    samples: samples.length,
    retainedValues,
    retainedAdapters,
  }
})
console.log(JSON.stringify({ node: process.version, report }, null, 2))
