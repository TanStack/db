/**
 * Repro for Bug 2: Many sibling toArray includes with chained derived collections.
 * Matches the exact darix entity-timeline query pattern.
 */
import { describe, expect, it } from 'vitest'
import {
  coalesce,
  createLiveQueryCollection,
  eq,
  toArray,
} from '../../src/query/index.js'
import { createCollection } from '../../src/collection/index.js'
import type { SyncConfig } from '../../src/types.js'

const TIMELINE_KEY = `timeline`

function createSyncCollection<T extends object>(
  id: string,
  getKey: (item: T) => string | number,
) {
  let syncBegin: () => void
  let syncWrite: (msg: { type: string; value: T }) => void
  let syncCommit: () => void

  const collection = createCollection<T>({
    id,
    getKey,
    sync: {
      sync: (params: any) => {
        syncBegin = params.begin
        syncWrite = params.write
        syncCommit = params.commit
        params.markReady()
        return () => {}
      },
    } as SyncConfig<T>,
    startSync: true,
    gcTime: 0,
  })

  return {
    collection,
    insert(value: T) {
      syncBegin!()
      syncWrite!({ type: `insert`, value })
      syncCommit!()
    },
  }
}

type RawItem = { key: string; _seq: number; [k: string]: unknown }

function createDerivedCollection(
  id: string,
  source: ReturnType<typeof createSyncCollection<any>>[`collection`],
  extraFields?: (d: any) => Record<string, unknown>,
) {
  return createLiveQueryCollection({
    id: `${id}:derived`,
    query: (q: any) =>
      q.from({ d: source }).select(({ d }: any) => ({
        timelineKey: TIMELINE_KEY,
        key: d.key,
        order: coalesce(d._seq, -1),
        ...(extraFields ? extraFields(d) : {}),
      })),
  })
}

describe(`many sibling toArray includes`, () => {
  it(`second insert propagates with 5 sibling chained toArray includes`, async () => {
    // Raw source collections
    const runs = createSyncCollection<RawItem>(`raw-runs`, (r) => r.key)
    const texts = createSyncCollection<RawItem>(`raw-texts`, (r) => r.key)
    const textDeltas = createSyncCollection<RawItem>(`raw-textDeltas`, (r) => r.key)
    const toolCalls = createSyncCollection<RawItem>(`raw-toolCalls`, (r) => r.key)
    const steps = createSyncCollection<RawItem>(`raw-steps`, (r) => r.key)

    // Layer 1: derived collections
    const derivedRuns = createDerivedCollection(`runs`, runs.collection, (d) => ({
      status: d.status,
    }))
    const derivedTexts = createDerivedCollection(`texts`, texts.collection, (d) => ({
      run_id: d.run_id,
      status: d.status,
    }))
    const derivedTextDeltas = createDerivedCollection(`textDeltas`, textDeltas.collection, (d) => ({
      text_id: d.text_id,
      run_id: d.run_id,
      delta: d.delta,
    }))
    const derivedToolCalls = createDerivedCollection(`toolCalls`, toolCalls.collection, (d) => ({
      run_id: d.run_id,
      tool_name: d.tool_name,
    }))
    const derivedSteps = createDerivedCollection(`steps`, steps.collection, (d) => ({
      run_id: d.run_id,
      step_number: d.step_number,
    }))

    // Seed collection
    const seeds = createCollection({
      id: `seed`,
      getKey: (s: { key: string }) => s.key,
      sync: {
        sync: (params: any) => {
          params.begin()
          params.write({ type: `insert`, value: { key: TIMELINE_KEY } })
          params.commit()
          params.markReady()
          return () => {}
        },
      } as SyncConfig<{ key: string }>,
      startSync: true,
      gcTime: 0,
    })

    // Layer 2: main query with many sibling includes
    const collection = createLiveQueryCollection({
      query: (q: any) =>
        q.from({ s: seeds }).select(({ s }: any) => ({
          key: s.key,
          runs: toArray(
            q
              .from({ r: derivedRuns })
              .where(({ r }: any) => eq(r.timelineKey, s.key))
              .orderBy(({ r }: any) => r.order)
              .select(({ r }: any) => ({ key: r.key, status: r.status })),
          ),
          texts: toArray(
            q
              .from({ t: derivedTexts })
              .where(({ t }: any) => eq(t.timelineKey, s.key))
              .orderBy(({ t }: any) => t.order)
              .select(({ t }: any) => ({ key: t.key, run_id: t.run_id, status: t.status })),
          ),
          textDeltas: toArray(
            q
              .from({ td: derivedTextDeltas })
              .where(({ td }: any) => eq(td.timelineKey, s.key))
              .orderBy(({ td }: any) => td.order)
              .select(({ td }: any) => ({
                key: td.key,
                text_id: td.text_id,
                delta: td.delta,
              })),
          ),
          toolCalls: toArray(
            q
              .from({ tc: derivedToolCalls })
              .where(({ tc }: any) => eq(tc.timelineKey, s.key))
              .orderBy(({ tc }: any) => tc.order)
              .select(({ tc }: any) => ({ key: tc.key, tool_name: tc.tool_name })),
          ),
          steps: toArray(
            q
              .from({ st: derivedSteps })
              .where(({ st }: any) => eq(st.timelineKey, s.key))
              .orderBy(({ st }: any) => st.order)
              .select(({ st }: any) => ({ key: st.key, step_number: st.step_number })),
          ),
        })),
    })

    await collection.preload()

    const data = () => collection.get(TIMELINE_KEY)

    // Insert run + text
    runs.insert({ key: `run-1`, status: `started`, _seq: 1 })
    texts.insert({ key: `text-1`, run_id: `run-1`, status: `streaming`, _seq: 2 })
    await new Promise((r) => setTimeout(r, 100))

    expect(data().runs).toHaveLength(1)
    expect(data().texts).toHaveLength(1)
    expect(data().textDeltas).toHaveLength(0)

    // First textDelta
    textDeltas.insert({ key: `td-1`, text_id: `text-1`, run_id: `run-1`, delta: `Hello`, _seq: 3 })
    await new Promise((r) => setTimeout(r, 100))
    expect(data().textDeltas).toHaveLength(1)
    expect(data().textDeltas[0].delta).toBe(`Hello`)

    // Second textDelta — the critical test
    textDeltas.insert({ key: `td-2`, text_id: `text-1`, run_id: `run-1`, delta: ` world`, _seq: 4 })
    await new Promise((r) => setTimeout(r, 100))
    expect(data().textDeltas).toHaveLength(2)
  })
})
