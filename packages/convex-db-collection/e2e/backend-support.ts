/** The task functions and row type that the backend oracle and its fixed tests share. */
import { makeFunctionReference } from 'convex/server'
import type { Value } from 'convex/values'

export type Task = {
  _id: string
  _creationTime: number
  clientId: string
  text: string
  rank: number
  payload?: Value
}
export const seed = makeFunctionReference<`mutation`, { count: number }, null>(
  `tasks:seed`,
)
export const all = makeFunctionReference<`query`, {}, Array<Task>>(`tasks:all`)
