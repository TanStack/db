import { z } from 'zod'
import { endpoints } from '../src/runtime'
import { DbClient, type Transaction } from '@tanstack/db'
const { query, mutation } = endpoints(new DbClient({ endpointScope: 'alice' }))
const list = query({
  input: z.object({}),
  async handler(_req, res) {
    return res.json([
      { id: 'id', text: 'text', completed: false, createdAt: new Date() },
    ])
  },
})
list.insert({ id: 'id', text: 'text', completed: false, createdAt: new Date() })
list.utils.refetch({ throwOnError: true })
const readFailed: boolean = list.utils.isError
const retryRead: Promise<void> = list.utils.clearError()
void readFailed
void retryRead
// @ts-expect-error refetch options retain query collection types
list.utils.refetch({ throwOnError: 'yes' })
const add = mutation({
  input: z.object({ text: z.string() }),
  onMutate({ input }) {
    const text: string = input.text
    void text
  },
  async handler(req, res) {
    return res.json({ text: req.body.text })
  },
})
const transaction: Transaction = add({ text: 'Typed task' })
transaction.isPersisted.promise
// @ts-expect-error an action returns a Transaction, not a Promise
add({ text: 'Typed task' }).then(() => {})
// @ts-expect-error mutation input retains schema types
add({ text: 10 })
// @ts-expect-error bound inserts require complete Todo rows
list.insert({ text: 'Missing key' })
// @ts-expect-error endpoints binds an actual DbClient
endpoints({})
const filtered = query({
  input: z.object({ completed: z.boolean() }),
  params: { completed: false },
  async handler(req, res) {
    const completed: boolean = req.body.completed
    return res.json([
      { id: 'id', text: 'text', completed, createdAt: new Date() },
    ])
  },
})
filtered.insert({
  id: 'id',
  text: 'text',
  completed: false,
  createdAt: new Date(),
})
query({
  input: z.object({ completed: z.boolean() }),
  // @ts-expect-error query parameters retain schema types
  params: { completed: 'false' },
  async handler(_req, res) {
    return res.json([])
  },
})

const ingredients = query({
  input: z.object({}),
  schema: z.object({ id: z.string(), name: z.string(), count: z.number() }),
  async handler(_req, res) {
    return res.json([{ id: 'flour', name: 'Flour', count: 1 }])
  },
})
ingredients.insert({ id: 'salt', name: 'Salt', count: 2 })
ingredients.utils.refetch()
// @ts-expect-error application collection fields retain their inferred types
ingredients.insert({ id: 'salt', name: 'Salt', count: 'two' })
