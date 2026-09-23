import { expect, it } from 'vitest'
import {
  captureSeedData,
  generateSeedData,
} from '../../db-collection-e2e/src/fixtures/seed-data'
import type { SeedDataResult } from '../../db-collection-e2e/src/types'
import type { FixtureValue } from '../../db-collection-e2e/src/fixtures/fixture-artifact'

function literalFixture(): SeedDataResult {
  return {
    users: [
      {
        id: 'user-a',
        name: 'A',
        email: null,
        age: -5,
        isActive: true,
        createdAt: new Date(1_710_381_566_535),
        metadata: { nested: { label: 'kept', count: 9007199254740993n } },
        deletedAt: null,
      },
    ],
    posts: [
      {
        id: 'post-a',
        userId: 'user-a',
        title: 'Owned',
        content: null,
        viewCount: 0,
        largeViewCount: 9007199254740993n,
        publishedAt: new Date(1_710_381_566_536),
        deletedAt: null,
      },
    ],
    comments: [
      {
        id: 'comment-a',
        postId: 'post-a',
        userId: 'user-a',
        text: 'Literal',
        createdAt: new Date(1_710_381_566_537),
        deletedAt: new Date(1_710_381_566_538),
      },
    ],
    userIds: ['user-a'],
    postIds: ['post-a'],
    commentIds: ['comment-a'],
  }
}

it('retains the exact literal seed independently of input, driver, and readers', () => {
  const input = literalFixture()
  const fixture = captureSeedData(input)
  const archived = fixture()
  const driver = fixture()
  input.users[0]!.name = 'input changed'
  input.users[0]!.createdAt.setTime(0)
  input.posts[0]!.largeViewCount = 1n
  input.userIds[0] = 'input-id'
  driver.users[0]!.metadata!.nested = { label: 'driver changed' }
  driver.posts[0]!.publishedAt!.setTime(0)
  driver.comments[0]!.deletedAt!.setTime(0)
  driver.posts[0]!.userId = 'wrong-edge'
  driver.commentIds.pop()

  const reader = fixture()
  reader.comments[0]!.text = 'reader changed'
  reader.postIds.push('reader-id')
  expect(fixture()).toEqual(literalFixture())
  expect(archived).toEqual(literalFixture())
  expect(fixture().posts[0]!.largeViewCount).toBe(9007199254740993n)
  expect(fixture().users[0]!.createdAt.getTime()).toBe(1_710_381_566_535)

  const wrongKey = fixture()
  wrongKey.users[0]!.id = 'other-user'
  expect(() => expect(wrongKey).toEqual(literalFixture())).toThrow()
  const wrongValue = fixture()
  wrongValue.posts[0]!.largeViewCount = 9007199254740992n
  expect(() => expect(wrongValue).toEqual(literalFixture())).toThrow()
})

it('preserves unknown own data fields and native values without a field whitelist', () => {
  const input = literalFixture()
  const extension = {
    extra: { time: new Date(1_710_381_566_539), number: 9007199254740995n },
    absent: undefined,
  }
  Object.assign(input.users[0]!, extension)
  const fixture = captureSeedData(input)
  extension.extra.time.setTime(0)
  extension.extra.number = 0n
  const first = fixture()
  expect(first.users[0]).toEqual({
    ...literalFixture().users[0],
    extra: { time: new Date(1_710_381_566_539), number: 9007199254740995n },
    absent: undefined,
  })
  expect(Object.hasOwn(first.users[0]!, 'absent')).toBe(true)
  Object.assign(first.users[0]!, { extra: null, absent: 'changed' })
  expect(fixture().users[0]).toEqual({
    ...literalFixture().users[0],
    extra: { time: new Date(1_710_381_566_539), number: 9007199254740995n },
    absent: undefined,
  })
})

it('captures one generated world without regenerating its random dates', () => {
  const input = generateSeedData()
  const expected = structuredClone(input)
  const fixture = captureSeedData(input)
  const archived = fixture()
  expect(input.users).toHaveLength(100)
  expect(input.posts).toHaveLength(100)
  expect(input.comments).toHaveLength(100)
  for (const user of input.users) {
    user.createdAt.setTime(0)
    if (user.deletedAt) user.deletedAt.setTime(0)
    user.name = 'driver replacement'
  }
  input.posts.splice(0, input.posts.length)
  input.comments.reverse()
  input.userIds.reverse()
  const delivered = fixture()
  delivered.postIds.reverse()
  delivered.comments[0]!.createdAt.setTime(0)
  expect(fixture()).toEqual(expected)
  expect(archived).toEqual(expected)
})

it('emits one fixture record at capture rather than on later reader access', () => {
  const records: Array<string> = []
  const input = literalFixture()
  const fixture: () => SeedDataResult = Reflect.apply(
    captureSeedData,
    undefined,
    [
      input,
      {
        registration: 'literal capture',
        provider: 'test sink',
        emit: (line: string) => records.push(line),
      },
    ],
  )
  expect(records).toHaveLength(1)
  const original = records[0]
  input.users[0]!.createdAt.setTime(0)
  fixture().posts[0]!.largeViewCount = 0n
  fixture()
  expect(records).toEqual([original])
})

function readFixtureRecord(line: string) {
  const prefix = '[db-e2e-fixture] '
  expect(line.startsWith(prefix)).toBe(true)
  return JSON.parse(line.slice(prefix.length)) as {
    version: number
    status: 'complete' | 'unsupported'
    registration: string
    provider: string
    capturedAt: number
    runtime: null
    providerVersion: null
    fixture: FixtureValue
    reason?: string
  }
}

// Test-local interpreter: the native decoded values are compared with an
// independently retained input, never with encoder-computed expectations.
function decodeFixtureValue(value: FixtureValue): unknown {
  switch (value[0]) {
    case 'null':
      return null
    case 'undefined':
      return undefined
    case 'boolean':
    case 'string':
      return value[1]
    case 'number':
      return Number(value[1])
    case 'bigint':
      return BigInt(value[1])
    case 'date':
      return new Date(Number(value[1]))
    case 'array':
      return value[1].map(decodeFixtureValue)
    case 'object':
      return Object.fromEntries(
        value[1].map(([key, item]) => [key, decodeFixtureValue(item)]),
      )
  }
}

it('records the exact native fixture and capture context before driver mutation', () => {
  const input = literalFixture()
  input.users[0]!.metadata = {
    tagShaped: ['date', '0'],
    objectTag: { type: 'bigint', value: '1' },
    native: { time: new Date(123), integer: 9007199254740999n },
    absent: undefined,
    numbers: [-0, NaN, Infinity, -Infinity],
  }
  const expected = structuredClone(input)
  const records: Array<string> = []
  const before = Date.now()
  const fixture = captureSeedData(input, {
    registration: 'literal',
    provider: 'recording test sink',
    emit: (line) => records.push(line),
  })
  const after = Date.now()
  expect(records).toHaveLength(1)
  input.users[0]!.metadata.native = 'driver changed'
  input.posts[0]!.largeViewCount = 0n
  fixture().comments[0]!.createdAt.setTime(0)
  const record = readFixtureRecord(records[0]!)
  expect(record).toMatchObject({
    version: 1,
    registration: 'literal',
    provider: 'recording test sink',
    runtime: null,
    providerVersion: null,
    status: 'complete',
  })
  expect(record.capturedAt).toBeGreaterThanOrEqual(before)
  expect(record.capturedAt).toBeLessThanOrEqual(after)
  const decoded = decodeFixtureValue(record.fixture) as SeedDataResult
  expect(decoded).toStrictEqual(expected)
  expect(decoded.users[0]!.createdAt).toBeInstanceOf(Date)
  expect(decoded.posts[0]!.largeViewCount).toBe(9007199254740993n)
  expect(Object.hasOwn(decoded.users[0]!.metadata!, 'absent')).toBe(true)
  const numbers = decoded.users[0]!.metadata!.numbers as Array<number>
  expect(Object.is(numbers[0], -0)).toBe(true)
  expect(Number.isNaN(numbers[1])).toBe(true)
  expect(numbers.slice(2)).toEqual([Infinity, -Infinity])
  expect(records).toHaveLength(1)
})

it.each(['empty', 'generated'] as const)(
  'logs the complete %s world without regenerating input',
  (kind) => {
    const input =
      kind === 'generated'
        ? generateSeedData()
        : {
            users: [],
            posts: [],
            comments: [],
            userIds: [],
            postIds: [],
            commentIds: [],
          }
    const expected = structuredClone(input)
    const records: Array<string> = []
    const fixture = captureSeedData(input, {
      registration: kind,
      provider: 'recording test sink',
      emit: (line) => records.push(line),
    })
    input.users.splice(0)
    input.comments.reverse()
    const record = readFixtureRecord(records[0]!)
    expect(record.status).toBe('complete')
    expect(decodeFixtureValue(record.fixture)).toStrictEqual(expected)
    expect(fixture()).toStrictEqual(expected)
    expect(records).toHaveLength(1)
  },
)

it.each(['map', 'set', 'shared', 'cycle', 'sparse'] as const)(
  'reports unsupported %s diagnostics without narrowing the original fixture getter',
  (kind) => {
    const input = literalFixture()
    const shared = { value: 1 }
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    const values = {
      map: new Map([['key', 1]]),
      set: new Set([1]),
      shared: { left: shared, right: shared },
      cycle,
      sparse: new Array(2),
    }
    input.users[0]!.metadata = { extension: values[kind] }
    const expected = structuredClone(input)
    const records: Array<string> = []
    const fixture = captureSeedData(input, {
      registration: kind,
      provider: 'recording test sink',
      emit: (line) => records.push(line),
    })
    expect(records).toHaveLength(1)
    const record = readFixtureRecord(records[0]!)
    expect(record.status).toBe('unsupported')
    expect(record.reason).toEqual(expect.any(String))
    expect(Object.hasOwn(record, 'fixture')).toBe(false)
    expect(fixture()).toStrictEqual(expected)
  },
)
