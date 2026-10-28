// Row types and fixture rows shared by the alias-shadowing oracle and its unit
// tests. The oracle file owns the law; these rows have no model of their own.

export type Lock = { id: number; name: string }
export type Vote = { id: number; lockId: number; lockName: string }
export type Context = Record<string, unknown>
export type ChildAlias = `lock` | `vote`

export const voteAt = (context: Context, alias: ChildAlias): Vote =>
  context[alias] as Vote

export const initialLocks: Array<Lock> = [
  { id: 1, name: `A` },
  { id: 2, name: `B` },
]

export const initialVotes: Array<Vote> = [
  { id: 10, lockId: 1, lockName: `A` },
  { id: 11, lockId: 1, lockName: `B` },
  { id: 12, lockId: 2, lockName: `B` },
  { id: 15, lockId: 99, lockName: `A` },
]
