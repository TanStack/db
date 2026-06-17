import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { queryOnce } from '../../src/query/index.js'
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

describe(`select() alias prototype pollution (issue #1584)`, () => {
  it(`should not allow __proto__ in alias path to pollute Object.prototype`, async () => {
    const users = makeCollection()
    const before = ({} as any).polluted

    await expect(
      queryOnce((q) =>
        q.from({ user: users }).select(({ user }) => ({
          [`__proto__.polluted`]: user.name,
        })),
      ),
    ).rejects.toThrow()

    const after = ({} as any).polluted
    expect(after).toBe(before)
    expect(({} as any).polluted).toBeUndefined()
  })

  it(`should reject constructor in alias path`, async () => {
    const users = makeCollection()
    await expect(
      queryOnce((q) =>
        q.from({ user: users }).select(({ user }) => ({
          [`constructor.prototype.polluted`]: user.name,
        })),
      ),
    ).rejects.toThrow()
    expect(({} as any).polluted).toBeUndefined()
  })
})
