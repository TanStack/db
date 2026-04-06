/**
 * Repro for bugs reported against TanStack DB 0.6
 * Bug 1: coalesce(concat(toArray(...))) bypasses includes detection
 * Bug 2: sequential inserts into toArray() child don't fully propagate
 */
import { describe, expect, it } from 'vitest'
import {
  coalesce,
  concat,
  createLiveQueryCollection,
  eq,
  toArray,
} from '../../src/query/index.js'
import { createCollection } from '../../src/collection/index.js'
import { localOnlyCollectionOptions } from '../../src/local-only.js'
import { mockSyncCollectionOptions } from '../utils.js'

describe(`bug repro`, () => {
  describe(`Bug 1: coalesce(concat(toArray(...)))`, () => {
    it(`throws a clear error when concat(toArray()) is wrapped in coalesce()`, () => {
      type Message = { id: number; role: string }
      type Chunk = {
        id: number
        messageId: number
        text: string
        timestamp: number
      }

      const messages = createCollection(
        mockSyncCollectionOptions<Message>({
          id: `bug1-messages`,
          getKey: (m) => m.id,
          initialData: [{ id: 1, role: `assistant` }],
        }),
      )

      const chunks = createCollection(
        mockSyncCollectionOptions<Chunk>({
          id: `bug1-chunks`,
          getKey: (c) => c.id,
          initialData: [{ id: 10, messageId: 1, text: `Hello`, timestamp: 1 }],
        }),
      )

      expect(() =>
        createLiveQueryCollection((q) =>
          q.from({ m: messages }).select(({ m }) => ({
            id: m.id,
            content: coalesce(
              concat(
                toArray(
                  q
                    .from({ c: chunks })
                    .where(({ c }) => eq(c.messageId, m.id))
                    .orderBy(({ c }) => c.timestamp)
                    .select(({ c }) => c.text),
                ),
              ) as any,
              ``,
            ),
          })),
        ),
      ).toThrow(`concat(toArray()) cannot be used inside expressions`)
    })

    it(`toArray() wrapped in coalesce() also throws`, () => {
      type Parent = { id: number }
      type Child = { id: number; parentId: number }

      const parents = createCollection(
        mockSyncCollectionOptions<Parent>({
          id: `bug1b-parents`,
          getKey: (p) => p.id,
          initialData: [{ id: 1 }],
        }),
      )

      const children = createCollection(
        mockSyncCollectionOptions<Child>({
          id: `bug1b-children`,
          getKey: (c) => c.id,
          initialData: [],
        }),
      )

      expect(() =>
        createLiveQueryCollection((q) =>
          q.from({ p: parents }).select(({ p }) => ({
            id: p.id,
            items: coalesce(
              toArray(
                q
                  .from({ c: children })
                  .where(({ c }) => eq(c.parentId, p.id))
                  .select(({ c }) => ({ id: c.id })),
              ) as any,
              [],
            ),
          })),
        ),
      ).toThrow(`toArray() cannot be used inside expressions`)
    })
  })

  describe(`Bug 2: sequential inserts into toArray child`, () => {
    it(`second insert propagates (mockSync)`, async () => {
      type Parent = { id: number; name: string }
      type Child = { id: number; parentId: number; title: string }

      const parents = createCollection(
        mockSyncCollectionOptions<Parent>({
          id: `bug2a-parents`,
          getKey: (p) => p.id,
          initialData: [{ id: 1, name: `Alpha` }],
        }),
      )

      const children = createCollection(
        mockSyncCollectionOptions<Child>({
          id: `bug2a-children`,
          getKey: (c) => c.id,
          initialData: [],
        }),
      )

      const collection = createLiveQueryCollection((q) =>
        q.from({ p: parents }).select(({ p }) => ({
          id: p.id,
          items: toArray(
            q
              .from({ c: children })
              .where(({ c }) => eq(c.parentId, p.id))
              .select(({ c }) => ({
                id: c.id,
                title: c.title,
              })),
          ),
        })),
      )

      await collection.preload()
      expect((collection.get(1) as any).items).toEqual([])

      // First insert
      children.utils.begin()
      children.utils.write({
        type: `insert`,
        value: { id: 10, parentId: 1, title: `First` },
      })
      children.utils.commit()
      expect((collection.get(1) as any).items).toHaveLength(1)

      // Second insert
      children.utils.begin()
      children.utils.write({
        type: `insert`,
        value: { id: 11, parentId: 1, title: `Second` },
      })
      children.utils.commit()
      expect((collection.get(1) as any).items).toHaveLength(2)
    })

    it(`second insert propagates (localOnly + collection.insert)`, async () => {
      type Parent = { id: number; name: string }
      type Child = { id: number; parentId: number; title: string }

      const parents = createCollection(
        localOnlyCollectionOptions<Parent>({
          id: `bug2b-parents`,
          getKey: (p) => p.id,
          initialData: [{ id: 1, name: `Alpha` }],
        }),
      )

      const children = createCollection(
        localOnlyCollectionOptions<Child>({
          id: `bug2b-children`,
          getKey: (c) => c.id,
          initialData: [],
        }),
      )

      const collection = createLiveQueryCollection((q) =>
        q.from({ p: parents }).select(({ p }) => ({
          id: p.id,
          items: toArray(
            q
              .from({ c: children })
              .where(({ c }) => eq(c.parentId, p.id))
              .select(({ c }) => ({
                id: c.id,
                title: c.title,
              })),
          ),
        })),
      )

      await collection.preload()
      expect((collection.get(1) as any).items).toEqual([])

      // First insert via collection.insert()
      children.insert({ id: 10, parentId: 1, title: `First` })
      await new Promise((r) => setTimeout(r, 50))
      expect((collection.get(1) as any).items).toHaveLength(1)

      // Second insert via collection.insert()
      children.insert({ id: 11, parentId: 1, title: `Second` })
      await new Promise((r) => setTimeout(r, 50))
      expect((collection.get(1) as any).items).toHaveLength(2)
    })

    it(`second insert propagates via concat(toArray)`, async () => {
      type Message = { id: number; role: string }
      type Chunk = {
        id: number
        messageId: number
        text: string
        timestamp: number
      }

      const messages = createCollection(
        localOnlyCollectionOptions<Message>({
          id: `bug2c-messages`,
          getKey: (m) => m.id,
          initialData: [{ id: 1, role: `assistant` }],
        }),
      )

      const chunks = createCollection(
        localOnlyCollectionOptions<Chunk>({
          id: `bug2c-chunks`,
          getKey: (c) => c.id,
          initialData: [],
        }),
      )

      const collection = createLiveQueryCollection((q) =>
        q.from({ m: messages }).select(({ m }) => ({
          id: m.id,
          content: concat(
            toArray(
              q
                .from({ c: chunks })
                .where(({ c }) => eq(c.messageId, m.id))
                .orderBy(({ c }) => c.timestamp)
                .select(({ c }) => c.text),
            ),
          ),
        })),
      )

      await collection.preload()
      expect((collection.get(1) as any).content).toBe(``)

      // First insert
      chunks.insert({
        id: 10,
        messageId: 1,
        text: `Hello`,
        timestamp: 1,
      })
      await new Promise((r) => setTimeout(r, 50))
      expect((collection.get(1) as any).content).toBe(`Hello`)

      // Second insert
      chunks.insert({
        id: 11,
        messageId: 1,
        text: ` world`,
        timestamp: 2,
      })
      await new Promise((r) => setTimeout(r, 50))
      expect((collection.get(1) as any).content).toBe(`Hello world`)
    })

    it(`second insert propagates through chained live query collections (darix pattern)`, async () => {
      // This matches the darix entity-timeline pattern:
      // Layer 1: raw collection → derived live query collection (adds synthetic key)
      // Layer 2: derived collection → main query with toArray() includes
      type RawDelta = {
        key: string
        text_id: string
        delta: string
        _seq: number
      }
      type DerivedDelta = {
        key: string
        text_id: string
        timelineKey: string
        order: number
        delta: string
      }
      type Seed = { key: string }

      const TIMELINE_KEY = `timeline-1`

      // Raw source collection
      const rawDeltas = createCollection(
        localOnlyCollectionOptions<RawDelta>({
          id: `chained-raw-deltas`,
          getKey: (d) => d.key,
          initialData: [],
        }),
      )

      // Layer 1: derived collection that adds timelineKey and renames _seq → order
      const derivedDeltas = createLiveQueryCollection<DerivedDelta>({
        id: `chained-derived-deltas`,
        query: (q) =>
          q.from({ d: rawDeltas }).select(({ d }) => ({
            key: d.key,
            text_id: d.text_id,
            timelineKey: TIMELINE_KEY,
            order: d._seq,
            delta: d.delta,
          })),
      })

      // Seed collection for singleton parent
      const seeds = createCollection(
        localOnlyCollectionOptions<Seed>({
          id: `chained-seeds`,
          getKey: (s) => s.key,
          initialData: [{ key: TIMELINE_KEY }],
        }),
      )

      // Layer 2: main query with toArray() include from derived collection
      const collection = createLiveQueryCollection({
        query: (q) =>
          q.from({ s: seeds }).select(({ s }) => ({
            key: s.key,
            deltas: toArray(
              q
                .from({ d: derivedDeltas })
                .where(({ d }) => eq(d.timelineKey, s.key))
                .orderBy(({ d }) => d.order)
                .select(({ d }) => ({
                  key: d.key,
                  delta: d.delta,
                })),
            ),
          })),
      })

      await collection.preload()
      const data = () => collection.get(TIMELINE_KEY) as any

      expect(data().deltas).toEqual([])

      // First insert into raw collection
      rawDeltas.insert({ key: `td-1`, text_id: `t-1`, delta: `Hello`, _seq: 1 })
      await new Promise((r) => setTimeout(r, 100))
      expect(data().deltas).toHaveLength(1)
      expect(data().deltas[0].delta).toBe(`Hello`)

      // Second insert — this is the critical path through chained collections
      rawDeltas.insert({
        key: `td-2`,
        text_id: `t-1`,
        delta: ` world`,
        _seq: 2,
      })
      await new Promise((r) => setTimeout(r, 100))
      expect(data().deltas).toHaveLength(2)
    })

    it(`second insert propagates with multiple sibling toArray includes`, async () => {
      type Seed = { key: string }
      type Text = { key: string; seedKey: string; status: string }
      type TextDelta = {
        key: string
        textId: string
        seedKey: string
        delta: string
        seq: number
      }

      const seeds = createCollection(
        localOnlyCollectionOptions<Seed>({
          id: `bug2d-seeds`,
          getKey: (s) => s.key,
          initialData: [{ key: `seed-1` }],
        }),
      )

      const texts = createCollection(
        localOnlyCollectionOptions<Text>({
          id: `bug2d-texts`,
          getKey: (t) => t.key,
          initialData: [],
        }),
      )

      const textDeltas = createCollection(
        localOnlyCollectionOptions<TextDelta>({
          id: `bug2d-textDeltas`,
          getKey: (td) => td.key,
          initialData: [],
        }),
      )

      // Singleton parent with multiple sibling toArray includes
      const collection = createLiveQueryCollection((q) =>
        q.from({ s: seeds }).select(({ s }) => ({
          key: s.key,
          texts: toArray(
            q
              .from({ t: texts })
              .where(({ t }) => eq(t.seedKey, s.key))
              .select(({ t }) => ({
                key: t.key,
                status: t.status,
              })),
          ),
          textDeltas: toArray(
            q
              .from({ td: textDeltas })
              .where(({ td }) => eq(td.seedKey, s.key))
              .orderBy(({ td }) => td.seq)
              .select(({ td }) => ({
                key: td.key,
                textId: td.textId,
                delta: td.delta,
              })),
          ),
        })),
      )

      await collection.preload()

      const data = () => collection.get(`seed-1`) as any

      // Insert text
      texts.insert({ key: `text-1`, seedKey: `seed-1`, status: `streaming` })
      await new Promise((r) => setTimeout(r, 50))
      expect(data().texts).toHaveLength(1)

      // Insert first delta
      textDeltas.insert({
        key: `td-1`,
        textId: `text-1`,
        seedKey: `seed-1`,
        delta: `Hello`,
        seq: 1,
      })
      await new Promise((r) => setTimeout(r, 50))
      expect(data().textDeltas).toHaveLength(1)
      expect(data().textDeltas[0].delta).toBe(`Hello`)

      // Insert second delta — this is the critical test
      textDeltas.insert({
        key: `td-2`,
        textId: `text-1`,
        seedKey: `seed-1`,
        delta: ` world`,
        seq: 2,
      })
      await new Promise((r) => setTimeout(r, 50))
      expect(data().textDeltas).toHaveLength(2)
    })
  })

  describe(`Bug 3: nested toArray includes (runs -> texts -> concat(toArray(textDeltas)))`, () => {
    it(`control: flat concat(toArray) propagates delta inserts`, async () => {
      type Text = { key: string; _seq: number; status: string }
      type TextDelta = {
        key: string
        text_id: string
        _seq: number
        delta: string
      }

      const texts = createCollection(
        localOnlyCollectionOptions<Text>({
          id: `nested-ctrl-texts`,
          getKey: (t) => t.key,
          initialData: [],
        }),
      )

      const textDeltas = createCollection(
        localOnlyCollectionOptions<TextDelta>({
          id: `nested-ctrl-deltas`,
          getKey: (d) => d.key,
          initialData: [],
        }),
      )

      const collection = createLiveQueryCollection({
        id: `nested-ctrl-live`,
        query: (q) =>
          q.from({ text: texts }).select(({ text }) => ({
            key: text.key,
            order: coalesce(text._seq, -1),
            status: text.status,
            text: concat(
              toArray(
                q
                  .from({ delta: textDeltas })
                  .where(({ delta }) => eq(delta.text_id, text.key))
                  .orderBy(({ delta }) => delta._seq)
                  .select(({ delta }) => delta.delta),
              ),
            ),
          })),
      })

      await collection.preload()

      texts.insert({ key: `text-1`, _seq: 1, status: `streaming` })
      await new Promise((r) => setTimeout(r, 50))
      expect((collection.get(`text-1`) as any)?.text).toBe(``)

      textDeltas.insert({
        key: `td-1`,
        text_id: `text-1`,
        _seq: 2,
        delta: `Hello`,
      })
      await new Promise((r) => setTimeout(r, 50))
      expect((collection.get(`text-1`) as any)?.text).toBe(`Hello`)

      textDeltas.insert({
        key: `td-2`,
        text_id: `text-1`,
        _seq: 3,
        delta: ` world`,
      })
      await new Promise((r) => setTimeout(r, 50))
      expect((collection.get(`text-1`) as any)?.text).toBe(`Hello world`)
    })

    it(`nested toArray(runs) -> toArray(texts) -> concat(toArray(textDeltas)) propagates`, async () => {
      const TIMELINE_KEY = `tl-nested`

      type Seed = { key: string }
      type Run = { key: string; _seq: number; status: string }
      type Text = {
        key: string
        run_id: string
        _seq: number
        status: string
      }
      type TextDelta = {
        key: string
        text_id: string
        run_id: string
        _seq: number
        delta: string
      }

      const seed = createCollection(
        localOnlyCollectionOptions<Seed>({
          id: `nested-seed`,
          getKey: (s) => s.key,
          initialData: [{ key: TIMELINE_KEY }],
        }),
      )

      const runs = createCollection(
        localOnlyCollectionOptions<Run>({
          id: `nested-runs`,
          getKey: (r) => r.key,
          initialData: [],
        }),
      )

      const texts = createCollection(
        localOnlyCollectionOptions<Text>({
          id: `nested-texts`,
          getKey: (t) => t.key,
          initialData: [],
        }),
      )

      const textDeltas = createCollection(
        localOnlyCollectionOptions<TextDelta>({
          id: `nested-deltas`,
          getKey: (d) => d.key,
          initialData: [],
        }),
      )

      // Layer 1: derived collections (matching darix pattern)
      const runsLive = createLiveQueryCollection({
        id: `nested-runs-live`,
        query: (q) =>
          q.from({ run: runs }).select(({ run }) => ({
            timelineKey: TIMELINE_KEY,
            key: run.key,
            order: coalesce(run._seq, -1),
            status: run.status,
          })),
      })

      const textsLive = createLiveQueryCollection({
        id: `nested-texts-live`,
        query: (q) =>
          q.from({ text: texts }).select(({ text }) => ({
            timelineKey: TIMELINE_KEY,
            key: text.key,
            run_id: text.run_id,
            order: coalesce(text._seq, -1),
            status: text.status,
          })),
      })

      const textDeltasLive = createLiveQueryCollection({
        id: `nested-deltas-live`,
        query: (q) =>
          q.from({ delta: textDeltas }).select(({ delta }) => ({
            timelineKey: TIMELINE_KEY,
            key: delta.key,
            text_id: delta.text_id,
            run_id: delta.run_id,
            order: coalesce(delta._seq, -1),
            delta: delta.delta,
          })),
      })

      // Layer 2: main query with nested includes
      const timeline = createLiveQueryCollection({
        id: `nested-timeline`,
        query: (q) =>
          q.from({ s: seed }).select(({ s }) => ({
            key: s.key,
            runs: toArray(
              q
                .from({ run: runsLive })
                .where(({ run }) => eq(run.timelineKey, s.key))
                .orderBy(({ run }) => run.order)
                .select(({ run }) => ({
                  key: run.key,
                  order: run.order,
                  status: run.status,
                  texts: toArray(
                    q
                      .from({ text: textsLive })
                      .where(({ text }) => eq(text.run_id, run.key))
                      .orderBy(({ text }) => text.order)
                      .select(({ text }) => ({
                        key: text.key,
                        run_id: text.run_id,
                        order: text.order,
                        status: text.status,
                        text: concat(
                          toArray(
                            q
                              .from({ delta: textDeltasLive })
                              .where(({ delta }) => eq(delta.text_id, text.key))
                              .orderBy(({ delta }) => delta.order)
                              .select(({ delta }) => delta.delta),
                          ),
                        ),
                      })),
                  ),
                })),
            ),
          })),
      })

      await timeline.preload()

      const data = () => timeline.get(TIMELINE_KEY) as any

      // Insert run + text
      runs.insert({ key: `run-1`, _seq: 1, status: `started` })
      texts.insert({
        key: `text-1`,
        run_id: `run-1`,
        _seq: 2,
        status: `streaming`,
      })
      await new Promise((r) => setTimeout(r, 100))

      expect(data().runs).toHaveLength(1)
      expect(data().runs[0].texts).toHaveLength(1)
      expect(data().runs[0].texts[0].text).toBe(``)

      // First textDelta
      textDeltas.insert({
        key: `td-1`,
        text_id: `text-1`,
        run_id: `run-1`,
        _seq: 3,
        delta: `Hello`,
      })
      await new Promise((r) => setTimeout(r, 100))
      expect(data().runs[0].texts[0].text).toBe(`Hello`)

      // Second textDelta
      textDeltas.insert({
        key: `td-2`,
        text_id: `text-1`,
        run_id: `run-1`,
        _seq: 4,
        delta: ` world`,
      })
      await new Promise((r) => setTimeout(r, 100))
      expect(data().runs[0].texts[0].text).toBe(`Hello world`)
    })

    it(`deep buffer change for one parent does not emit spurious update for sibling parent`, async () => {
      const TIMELINE_KEY = `tl-spurious`

      type Seed = { key: string }
      type Run = { key: string; _seq: number; status: string }
      type Text = {
        key: string
        run_id: string
        _seq: number
        status: string
      }
      type TextDelta = {
        key: string
        text_id: string
        run_id: string
        _seq: number
        delta: string
      }

      const seed = createCollection(
        localOnlyCollectionOptions<Seed>({
          id: `spurious-seed`,
          getKey: (s) => s.key,
          initialData: [{ key: TIMELINE_KEY }],
        }),
      )

      const runs = createCollection(
        localOnlyCollectionOptions<Run>({
          id: `spurious-runs`,
          getKey: (r) => r.key,
          initialData: [],
        }),
      )

      const texts = createCollection(
        localOnlyCollectionOptions<Text>({
          id: `spurious-texts`,
          getKey: (t) => t.key,
          initialData: [],
        }),
      )

      const textDeltas = createCollection(
        localOnlyCollectionOptions<TextDelta>({
          id: `spurious-deltas`,
          getKey: (d) => d.key,
          initialData: [],
        }),
      )

      // Layer 1: derived collections
      const runsLive = createLiveQueryCollection({
        id: `spurious-runs-live`,
        query: (q) =>
          q.from({ run: runs }).select(({ run }) => ({
            timelineKey: TIMELINE_KEY,
            key: run.key,
            order: coalesce(run._seq, -1),
            status: run.status,
          })),
      })

      const textsLive = createLiveQueryCollection({
        id: `spurious-texts-live`,
        query: (q) =>
          q.from({ text: texts }).select(({ text }) => ({
            timelineKey: TIMELINE_KEY,
            key: text.key,
            run_id: text.run_id,
            order: coalesce(text._seq, -1),
            status: text.status,
          })),
      })

      const textDeltasLive = createLiveQueryCollection({
        id: `spurious-deltas-live`,
        query: (q) =>
          q.from({ delta: textDeltas }).select(({ delta }) => ({
            timelineKey: TIMELINE_KEY,
            key: delta.key,
            text_id: delta.text_id,
            run_id: delta.run_id,
            order: coalesce(delta._seq, -1),
            delta: delta.delta,
          })),
      })

      // Layer 2: main query with nested includes
      const timeline = createLiveQueryCollection({
        id: `spurious-timeline`,
        query: (q) =>
          q.from({ s: seed }).select(({ s }) => ({
            key: s.key,
            runs: toArray(
              q
                .from({ run: runsLive })
                .where(({ run }) => eq(run.timelineKey, s.key))
                .orderBy(({ run }) => run.order)
                .select(({ run }) => ({
                  key: run.key,
                  order: run.order,
                  status: run.status,
                  texts: toArray(
                    q
                      .from({ text: textsLive })
                      .where(({ text }) => eq(text.run_id, run.key))
                      .orderBy(({ text }) => text.order)
                      .select(({ text }) => ({
                        key: text.key,
                        run_id: text.run_id,
                        order: text.order,
                        status: text.status,
                        text: concat(
                          toArray(
                            q
                              .from({ delta: textDeltasLive })
                              .where(({ delta }) => eq(delta.text_id, text.key))
                              .orderBy(({ delta }) => delta.order)
                              .select(({ delta }) => delta.delta),
                          ),
                        ),
                      })),
                  ),
                })),
            ),
          })),
      })

      await timeline.preload()

      const data = () => timeline.get(TIMELINE_KEY) as any

      // Insert TWO runs, each with their own text
      runs.insert({ key: `run-1`, _seq: 1, status: `started` })
      runs.insert({ key: `run-2`, _seq: 2, status: `started` })
      texts.insert({
        key: `text-1`,
        run_id: `run-1`,
        _seq: 3,
        status: `streaming`,
      })
      texts.insert({
        key: `text-2`,
        run_id: `run-2`,
        _seq: 4,
        status: `streaming`,
      })
      await new Promise((r) => setTimeout(r, 100))

      expect(data().runs).toHaveLength(2)
      expect(data().runs[0].texts[0].text).toBe(``)
      expect(data().runs[1].texts[0].text).toBe(``)

      // Capture the timeline row reference BEFORE the delta insert
      const timelineRowBefore = data()
      const run1TextsBefore = timelineRowBefore.runs[0].texts
      // Track update events on the timeline collection
      const updateEvents: Array<any> = []
      timeline.subscribeChanges((changes) => {
        for (const change of changes) {
          if (change.type === `update`) {
            updateEvents.push(change)
          }
        }
      })

      // Insert a textDelta ONLY for run-2's text
      textDeltas.insert({
        key: `td-1`,
        text_id: `text-2`,
        run_id: `run-2`,
        _seq: 5,
        delta: `Hello`,
      })
      await new Promise((r) => setTimeout(r, 100))

      // Verify run-2's text updated correctly
      expect(data().runs[1].texts[0].text).toBe(`Hello`)
      // Verify run-1's text is still empty
      expect(data().runs[0].texts[0].text).toBe(``)

      // The critical check: only ONE update event should fire (for the timeline row).
      // If the deep-buffer pass marks unrelated parents dirty, we'd see multiple
      // updates or the runs[0].texts array would be unnecessarily re-materialized.
      // Check that run-1's texts array reference is unchanged (not re-materialized)
      expect(data().runs[0].texts).toBe(run1TextsBefore)
    })
  })
})
