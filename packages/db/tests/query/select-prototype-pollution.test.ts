import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { queryOnce } from '../../src/query/index.js'
import { UnsafeAliasPathError } from '../../src/errors.js'
import { mockSyncCollectionOptions } from '../utils.js'

type User = { id: number; name: string }

const sampleUsers: Array<User> = [
  { id: 1, name: `Alice` },
  { id: 2, name: `Bob` },
]

function makeCollection() {
  return createCollection(
    mockSyncCollectionOptions<User>({
      id: `proto-pollution-users`,
      getKey: (u) => u.id,
      initialData: sampleUsers,
    }),
  )
}

function prototypeHasOwn(prop: string): boolean {
  return Object.prototype.hasOwnProperty.call(Object.prototype, prop)
}

describe(`select() alias prototype pollution (issue #1584)`, () => {
  it(`should reject __proto__ in alias path and not pollute Object.prototype`, async () => {
    const users = makeCollection()
    const hadBefore = prototypeHasOwn(`polluted`)

    await expect(
      queryOnce((q) =>
        q.from({ user: users }).select(({ user }) => ({
          [`__proto__.polluted`]: user.name,
        })),
      ),
    ).rejects.toThrow(UnsafeAliasPathError)

    expect(prototypeHasOwn(`polluted`)).toBe(hadBefore)
    expect(prototypeHasOwn(`polluted`)).toBe(false)
  })

  it(`should reject constructor in alias path and not pollute Object.prototype`, async () => {
    const users = makeCollection()
    const hadBefore = prototypeHasOwn(`polluted`)

    await expect(
      queryOnce((q) =>
        q.from({ user: users }).select(({ user }) => ({
          [`constructor.prototype.polluted`]: user.name,
        })),
      ),
    ).rejects.toThrow(UnsafeAliasPathError)

    expect(prototypeHasOwn(`polluted`)).toBe(hadBefore)
    expect(prototypeHasOwn(`polluted`)).toBe(false)
  })
})
