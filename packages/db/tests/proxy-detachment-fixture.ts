/**
 * Fixtures and checks shared by proxy-detachment-contract-oracle.test.ts,
 * which owns the detachment law, and proxy-detachment-contract.test.ts, which
 * holds the ordinary detachment regressions. The native structuredClone and
 * cycle-shape checks here are the independent comparisons.
 */
import { expect } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { declareOracle } from './oracle-declaration.js'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { CollectionConfig } from '../src/types.js'

export class Label {
  #text: string
  constructor(text: string) {
    this.#text = text
  }
  read() {
    return this.#text
  }
  rename(text: string) {
    this.#text = text
  }
}

// The handler confirms each update through sync, so the stored row is the
// update's result once the mutation settles.
export function storedRowOptions<T extends object>(row: T & { id: number }) {
  let confirm: (rows: Array<T & { id: number }>) => void = () => {}
  return {
    getKey: (value) => value.id,
    startSync: true,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        write({ type: `insert`, value: row })
        commit()
        markReady()
        confirm = (rows) => {
          begin()
          for (const value of rows) write({ type: `update`, value })
          commit()
        }
      },
    },
    onUpdate: ({ transaction }) => {
      confirm(transaction.mutations.map((mutation) => mutation.modified))
      return Promise.resolve()
    },
  } satisfies CollectionConfig<T & { id: number }, number>
}

export function storedRow<T extends object>(row: T & { id: number }) {
  return createCollection(storedRowOptions(row))
}

export function storedDataRow(
  row: Record<string, unknown> & { id: number },
  identitySchema: boolean,
) {
  if (!identitySchema) return storedRow(row)
  const schema: StandardSchemaV1<typeof row, typeof row> = {
    '~standard': {
      version: 1,
      vendor: `identity`,
      validate: (value) => ({ value: value as typeof row }),
    },
  }
  return createCollection({ ...storedRowOptions(row), schema })
}

export type CycleKind = `Map` | `Set` | `array` | `object`
export type CycleMember = { owner: CycleRow }
export type CycleContainer =
  | Map<string, CycleMember>
  | Set<CycleMember>
  | Array<CycleMember>
  | { member: CycleMember }
export type CycleRow = { id: number; count: number; link?: CycleContainer }

export const cycleKinds: ReadonlyArray<CycleKind> = [
  `Map`,
  `Set`,
  `array`,
  `object`,
]

export function cycleContainer(
  kind: CycleKind,
  owner: CycleRow,
): CycleContainer {
  const member = { owner }
  if (kind === `Map`) return new Map([[`member`, member]])
  if (kind === `Set`) return new Set([member])
  if (kind === `array`) return [member]
  return { member }
}

export function cycleMember(link: CycleContainer | undefined, kind: CycleKind) {
  if (kind === `Map`) {
    expect(link).toBeInstanceOf(Map)
    const map = link as Map<string, CycleMember>
    expect([...map.keys()]).toEqual([`member`])
    return map.get(`member`)!
  }
  if (kind === `Set`) {
    expect(link).toBeInstanceOf(Set)
    const set = link as Set<CycleMember>
    expect(set.size).toBe(1)
    return [...set][0]!
  }
  if (kind === `array`) {
    expect(Array.isArray(link)).toBe(true)
    expect(link).toHaveLength(1)
    return (link as Array<CycleMember>)[0]!
  }
  expect(Object.keys(link!)).toEqual([`member`])
  return (link as { member: CycleMember }).member
}

export function expectCycleSnapshot(row: CycleRow, kind: CycleKind) {
  expect(row.id).toBe(1)
  expect(row.count).toBe(1)
  const member = cycleMember(row.link, kind)
  expect(Object.keys(member)).toEqual([`owner`])
  const owner = member.owner
  expect(owner.id).toBe(1)
  expect(owner.count).toBe(1)
  expect(owner.link).toBe(row.link)
  expect(cycleMember(owner.link, kind).owner).toBe(owner)
}

export function expectOwnDataProperty(
  object: object,
  key: string,
  value: unknown,
) {
  expect(Object.hasOwn(object, key)).toBe(true)
  expect(Object.getPrototypeOf(object)).toBe(Object.prototype)
  expect((object as Record<string, unknown>)[key]).toStrictEqual(value)
}

// The native structuredClone of an assigned payload is the model. The detached
// draft must serialize to the same JSON, before and after the caller edits
// its original object.
export function expectDetachedPayloadJson(
  actual: unknown,
  expected: unknown,
): void {
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected))
}

// The native structuredClone of an assigned binary value is the model. The
// detached draft keeps the clone's bytes, class tag, and view range after the
// caller overwrites its source buffer.
export function expectDetachedBinaryClone(
  actual: unknown,
  expected: unknown,
): void {
  const buffer = (input: unknown) =>
    ArrayBuffer.isView(input) ? input.buffer : (input as ArrayBuffer)
  expect([...new Uint8Array(buffer(actual))]).toEqual([
    ...new Uint8Array(buffer(expected)),
  ])
  expect(Object.prototype.toString.call(actual)).toBe(
    Object.prototype.toString.call(expected),
  )
  if (ArrayBuffer.isView(actual) && ArrayBuffer.isView(expected)) {
    expect(actual.byteOffset).toBe(expected.byteOffset)
    expect(actual.byteLength).toBe(expected.byteLength)
  }
}

declareOracle({
  check: [
    expectCycleSnapshot,
    expectOwnDataProperty,
    expectDetachedPayloadJson,
    expectDetachedBinaryClone,
  ],
})
