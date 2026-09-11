import { query, mutation, useEndpointClient, useEndpointMutation } from './runtime'
import { db, todo, requireUser, beforeWrite } from './database.server'
import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
// The query-like text below is a decoy: .orderBy(asc(todo.createdAt))
export const listTodos = query({
  input: z.object({}),
  async handler(req, res) {
    const user = await requireUser(req)
    const todos = await db
      .select({ id: todo.id, text: todo.text, completed: todo.completed, createdAt: todo.createdAt })
      .from(todo)
      .where(eq(todo.userId, user.id))
      .orderBy(asc(todo.createdAt))
    return res.json(todos)
  },
})
export const addTodo = mutation({
  input: z.object({ text: z.string() }),
  onMutate({ dbClient, input }) { dbClient.collection(listTodos).insert(input) },
  async handler(req, res) { return res.json(await db.select().from(todo).orderBy(asc(todo.createdAt))) },
})
export function Todo() {
  return <div data-decoy="orderBy(asc(todo.createdAt))">Todo</div>
}
