// Auth/db/query are fixture bindings; this source is parsed, never imported.
import { asc, eq } from 'drizzle-orm'
import { db, todo, query, requireUser } from './fixture-bindings'
export const listTodos = query({
  async handler(req, res) {
    const user = await requireUser(req)
    const todos = await db
      .select({ id: todo.id, text: todo.text, completed: todo.completed, createdAt: todo.createdAt })
      .from(todo)
      .where(eq(todo.userId, user.id))
      .orderBy(asc(todo.createdAt), asc(todo.id))
    return res.json(todos)
  },
})
