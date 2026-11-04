import { afterEach, describe, expect, it } from 'vitest'
import {
  createLiveQueryCollection,
  eq,
  not,
  toArray,
} from '../../src/query/index.js'
import { createCollection } from '../../src/collection/index.js'
import { BasicIndex } from '../../src/indexes/basic-index.js'
import { flushPromises } from '../utils.js'
import type { LoadSubsetOptions } from '../../src/types.js'

type Task = { id: number; title: string }
type TaskTag = { id: number; task_id: number; tag_id: number }
type Tag = { id: number; name: string; type: string }

const taskRows: Array<Task> = [
  { id: 1, title: `one` },
  { id: 2, title: `two` },
]
const taskTagRows: Array<TaskTag> = [
  { id: 100, task_id: 1, tag_id: 7 },
  { id: 101, task_id: 1, tag_id: 8 },
  { id: 102, task_id: 2, tag_id: 9 },
]
// Tags 10 and 11 are named by no tagging: a keyed load must not ask for them.
const tagRows: Array<Tag> = [
  { id: 7, name: `seven`, type: `user` },
  { id: 8, name: `eight`, type: `generated` },
  { id: 9, name: `nine`, type: `user` },
  { id: 10, name: `ten`, type: `user` },
  { id: 11, name: `eleven`, type: `user` },
]

let sequence = 0
const cleanups: Array<() => void | Promise<void>> = []

function createEagerCollection<T extends { id: number }>(
  name: string,
  rows: Array<T>,
) {
  const collection = createCollection<T, number>({
    id: `lazy-join-where-${name}-${sequence++}`,
    getKey: (row) => row.id,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        for (const row of rows) write({ type: `insert`, value: row })
        commit()
        markReady()
      },
    },
  })
  cleanups.push(() => collection.cleanup())
  return collection
}

// An on-demand source that serves every loadSubset from its full table, as
// a server would, and records the options each load receives.
function createOnDemandCollection<T extends { id: number }>(
  name: string,
  rows: Array<T>,
) {
  const loads: Array<LoadSubsetOptions> = []
  const collection = createCollection<T, number>({
    id: `lazy-join-where-${name}-${sequence++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    autoIndex: `eager`,
    defaultIndexType: BasicIndex,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        markReady()
        return {
          loadSubset: (options: LoadSubsetOptions) => {
            loads.push(options)
            begin()
            for (const row of rows) {
              if (collection.has(row.id)) continue
              write({ type: `insert`, value: row })
            }
            commit()
            return Promise.resolve()
          },
        }
      },
    },
  })
  cleanups.push(() => collection.cleanup())
  return { collection, loads }
}

// Lazy demand is the only part of a load that names join keys, so a keyed
// load is one whose predicate mentions `id IN (...)`.
function describeLoad(options: LoadSubsetOptions): string {
  return JSON.stringify(options.where)
}

function hasKeyFilter(options: LoadSubsetOptions, keys: Array<number>) {
  const where = describeLoad(options)
  return where.includes(`"name":"in"`) && where.includes(JSON.stringify(keys))
}

describe(`lazy join source where`, () => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  })

  it(`include: a where on the lazy joined side keeps the join-key filter`, async () => {
    const tasks = createEagerCollection(`tasks`, taskRows)
    const taskTags = createEagerCollection(`task-tags`, taskTagRows)
    const { collection: tags, loads } = createOnDemandCollection(
      `tags`,
      tagRows,
    )

    const live = createLiveQueryCollection((q) =>
      q.from({ task: tasks }).select(({ task }) => ({
        id: task.id,
        tags: toArray(
          q
            .from({ taskTag: taskTags })
            .where(({ taskTag }) => eq(taskTag.task_id, task.id))
            .innerJoin({ tag: tags }, ({ taskTag, tag }) =>
              eq(taskTag.tag_id, tag.id),
            )
            .where(({ tag }) => not(eq(tag.type, `generated`)))
            .select(({ tag }) => ({ id: tag.id, name: tag.name })),
        ),
      })),
    )
    cleanups.push(() => live.cleanup())
    await live.preload()
    await flushPromises()

    expect(loads.length).toBeGreaterThan(0)
    for (const load of loads) {
      expect(hasKeyFilter(load, [7, 8, 9]), describeLoad(load)).toBe(true)
    }
    expect(
      live.toArray
        .map((task) => ({
          id: task.id,
          tags: [...task.tags].map((tag) => tag.id).sort(),
        }))
        .sort((a, b) => a.id - b.id),
    ).toEqual([
      { id: 1, tags: [7] },
      { id: 2, tags: [9] },
    ])
  })

  it(`include: a where on the parent-filtered side keeps the join-key filter`, async () => {
    const tasks = createEagerCollection(`tasks`, taskRows)
    const taskTags = createEagerCollection(`task-tags`, taskTagRows)
    const { collection: tags, loads } = createOnDemandCollection(
      `tags`,
      tagRows,
    )

    const live = createLiveQueryCollection((q) =>
      q.from({ task: tasks }).select(({ task }) => ({
        id: task.id,
        tags: toArray(
          q
            .from({ taskTag: taskTags })
            .where(({ taskTag }) => eq(taskTag.task_id, task.id))
            .where(({ taskTag }) => not(eq(taskTag.tag_id, 8)))
            .innerJoin({ tag: tags }, ({ taskTag, tag }) =>
              eq(taskTag.tag_id, tag.id),
            )
            .select(({ tag }) => ({ id: tag.id, name: tag.name })),
        ),
      })),
    )
    cleanups.push(() => live.cleanup())
    await live.preload()
    await flushPromises()

    expect(loads.length).toBeGreaterThan(0)
    for (const load of loads) {
      expect(hasKeyFilter(load, [7, 9]), describeLoad(load)).toBe(true)
    }
  })

  it(`leftJoin: a where on the lazy joined side keeps the join-key filter`, async () => {
    const taskTags = createEagerCollection(`task-tags`, taskTagRows)
    const { collection: tags, loads } = createOnDemandCollection(
      `tags`,
      tagRows,
    )

    const live = createLiveQueryCollection((q) =>
      q
        .from({ taskTag: taskTags })
        .leftJoin({ tag: tags }, ({ taskTag, tag }) =>
          eq(taskTag.tag_id, tag.id),
        )
        .where(({ tag }) => not(eq(tag.type, `generated`)))
        .select(({ taskTag, tag }) => ({ id: taskTag.id, tagId: tag.id })),
    )
    cleanups.push(() => live.cleanup())
    await live.preload()
    await flushPromises()

    expect(loads.length).toBeGreaterThan(0)
    for (const load of loads) {
      expect(hasKeyFilter(load, [7, 8, 9]), describeLoad(load)).toBe(true)
    }
  })
})
