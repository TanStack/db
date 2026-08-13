import { performance } from 'node:perf_hooks'
import { afterAll, describe, it } from 'vitest'
import { createRoot, flush } from 'solid-js'
import { createCollection, eq } from '@tanstack/db'
import { useLiveQuery } from '../src/useLiveQuery'
import { mockSyncCollectionOptions } from '../../db/tests/utils'

type Row = { id: string; name: string; age: number; email: string; isActive: boolean; team: string }

function makeRows(n: number): Array<Row> {
  const rows: Array<Row> = []
  for (let i = 0; i < n; i++) {
    rows.push({
      id: String(i),
      name: `Person ${i}`,
      age: 20 + (i % 50),
      email: `person${i}@example.com`,
      isActive: true,
      team: `team${i % 5}`,
    })
  }
  return rows
}

function makeCollection(n: number, idPrefix: string) {
  return createCollection(
    mockSyncCollectionOptions<Row>({
      id: `bench-${idPrefix}-${n}`,
      getKey: (r: Row) => r.id,
      initialData: makeRows(n),
    }),
  )
}

function updateRow(collection: ReturnType<typeof makeCollection>, id: string, name: string) {
  collection.utils.begin()
  collection.utils.write({
    type: 'update',
    value: { id, name, age: 99, email: `updated-${id}@example.com`, isActive: false, team: 'team-x' },
  })
  collection.utils.commit()
}

function batchUpdate(collection: ReturnType<typeof makeCollection>, count: number, totalRows: number) {
  collection.utils.begin()
  for (let i = 0; i < count; i++) {
    const id = String(i % totalRows)
    collection.utils.write({
      type: 'update',
      value: { id, name: `Updated ${id} v${Date.now()}`, age: 99, email: `u${id}@e.com`, isActive: false, team: 'team-x' },
    })
  }
  collection.utils.commit()
}

function median(values: Array<number>): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const a = sorted[mid] ?? 0
  const b = sorted[mid - 1] ?? 0
  return sorted.length % 2 !== 0 ? a : (a + b) / 2
}

const ITERATIONS = 5

function bench(label: string, fn: () => void): number {
  const times: Array<number> = []
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now()
    fn()
    times.push(performance.now() - start)
  }
  const result = median(times)
  console.log(`  ${label}: ${result.toFixed(2)}ms`)
  return result
}

function benchAsync(label: string, fn: () => Promise<void>): Promise<number> {
  return (async () => {
    const times: Array<number> = []
    for (let i = 0; i < ITERATIONS; i++) {
      const start = performance.now()
      await fn()
      times.push(performance.now() - start)
    }
    const result = median(times)
    console.log(`  ${label}: ${result.toFixed(2)}ms`)
    return result
  })()
}

describe('benchmarks', () => {
  const results: Array<{ case: string; wholesale: number }> = []

  afterAll(() => {
    console.log('\n=== BENCHMARK RESULTS ===\n')
    console.log('| Case | Time |')
    console.log('| ---- | ---- |')
    for (const r of results) {
      console.log(`| ${r.case} | ${r.wholesale.toFixed(2)}ms |`)
    }
  })

  const SIZES = [10, 1000, 10000]

  for (const n of SIZES) {
    it(`Initial mount — ${n} rows`, async () => {
      const time = await benchAsync(`Mount ${n}`, async () => {
        const collection = makeCollection(n, `mount-${n}`)
        await new Promise<void>((resolve) => {
          createRoot((dispose) => {
            const query = useLiveQuery((q) => q.from({ data: collection }).select(({ data }) => ({
              id: data.id, name: data.name,
            })))
            try { query(); resolve() } catch { /* loading */ }
            if (query.isReady) { resolve() }
            dispose()
          })
        })
      })
      results.push({ case: `Initial mount (${n} rows)`, wholesale: time })
    })

    it(`Single-row update — ${n} rows`, async () => {
      const collection = makeCollection(n, `update-${n}`)
      const query = createRoot((dispose) => {
        const q = useLiveQuery((q) => q.from({ data: collection }).select(({ data }) => ({
          id: data.id, name: data.name,
        })))
        return { query: q, dispose }
      })

      await new Promise((resolve) => setTimeout(resolve, 50))

      const time = bench(`Update 1/${n}`, () => {
        updateRow(collection, '0', 'Updated Person 0')
        flush()
      })

      query.dispose()
      results.push({ case: `Single-row update (${n} rows)`, wholesale: time })
    })

    it(`10% batch update — ${n} rows`, async () => {
      const collection = makeCollection(n, `batch-${n}`)
      const query = createRoot((dispose) => {
        const q = useLiveQuery((q) => q.from({ data: collection }).select(({ data }) => ({
          id: data.id, name: data.name,
        })))
        return { query: q, dispose }
      })

      await new Promise((resolve) => setTimeout(resolve, 50))

      const batchSize = Math.max(1, Math.floor(n * 0.1))
      const time = bench(`Batch ${batchSize}/${n}`, () => {
        batchUpdate(collection, batchSize, n)
        flush()
      })

      query.dispose()
      results.push({ case: `10% batch update (${n} rows)`, wholesale: time })
    })
  }

  it('Repeated updates — 1000 rows × 200 commits', async () => {
    const collection = makeCollection(1000, 'repeated')
    const query = createRoot((dispose) => {
      const q = useLiveQuery((q) => q.from({ data: collection }).select(({ data }) => ({
        id: data.id, name: data.name,
      })))
      return { query: q, dispose }
    })

    await new Promise((resolve) => setTimeout(resolve, 50))

    const time = bench('200 commits', () => {
      for (let i = 0; i < 200; i++) {
        updateRow(collection, String(i % 1000), `Updated ${i}`)
        flush()
      }
    })

    query.dispose()
    results.push({ case: 'Repeated updates (1000×200)', wholesale: time })
  })

  it('findOne update — 1000 rows', async () => {
    const collection = makeCollection(1000, 'findone')
    const query = createRoot((dispose) => {
      const q = useLiveQuery((q) =>
        q.from({ data: collection }).where(({ data }) => eq(data.id, '500')).findOne(),
      )
      return { query: q, dispose }
    })

    await new Promise((resolve) => setTimeout(resolve, 50))

    const time = bench('findOne update', () => {
      updateRow(collection, '500', 'Updated 500')
      flush()
    })

    query.dispose()
    results.push({ case: 'findOne update (1000 rows)', wholesale: time })
  })

  it('Remount after update — 1000 rows', async () => {
    const collection = makeCollection(1000, 'remount')
    const first = createRoot((dispose) => {
      const q = useLiveQuery((q) => q.from({ data: collection }).select(({ data }) => ({
        id: data.id, name: data.name,
      })))
      return { query: q, dispose }
    })

    await new Promise((resolve) => setTimeout(resolve, 50))
    updateRow(collection, '0', 'Changed')
    flush()
    first.dispose()

    const time = bench('Remount', () => {
      createRoot((dispose) => {
        const q = useLiveQuery((q) => q.from({ data: collection }).select(({ data }) => ({
          id: data.id, name: data.name,
        })))
        try { q() } catch { /* loading */ }
        dispose()
      })
    })

    results.push({ case: 'Remount after update (1000 rows)', wholesale: time })
  })
})
