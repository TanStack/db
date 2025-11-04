import { createServerFileRoute } from "@tanstack/react-start/server"
import { json } from "@tanstack/react-start"
import type { TodoUpdate } from "~/utils/todos"
import { todoService } from "~/utils/todos"

export const ServerRoute = createServerFileRoute(`/api/todos/$todoId`).methods({
  GET: async ({ params, request }) => {
    console.info(`GET /api/todos/${params.todoId} @`, request.url)

    try {
      const todo = await todoService.withDelay(() => {
        todoService.simulateFailure(0.1)
        return todoService.getById(params.todoId)
      })

      if (!todo) {
        return json({ error: `Todo not found` }, { status: 404 })
      }

      return json(todo)
    } catch (error) {
      console.error(`Error fetching todo:`, error)
      return json({ error: `Failed to fetch todo` }, { status: 500 })
    }
  },

  PUT: async ({ params, request }) => {
    console.info(`PUT /api/todos/${params.todoId} @`, request.url)

    try {
      const body = (await request.json()) as TodoUpdate

      const todo = await todoService.withDelay(() => {
        todoService.simulateFailure(0.15)
        return todoService.update(params.todoId, body)
      })

      if (!todo) {
        return json({ error: `Todo not found` }, { status: 404 })
      }

      return json(todo)
    } catch (error) {
      console.error(`Error updating todo:`, error)
      if (error instanceof Error && error.message.includes(`Simulated`)) {
        return json(
          { error: `Network error - please try again` },
          { status: 503 }
        )
      }
      return json({ error: `Failed to update todo` }, { status: 500 })
    }
  },

  DELETE: async ({ params, request }) => {
    console.info(`DELETE /api/todos/${params.todoId} @`, request.url)

    try {
      const success = await todoService.withDelay(() => {
        todoService.simulateFailure(0.15)
        return todoService.delete(params.todoId)
      })

      if (!success) {
        return json({ error: `Todo not found` }, { status: 404 })
      }

      return json({ success: true })
    } catch (error) {
      console.error(`Error deleting todo:`, error)
      if (error instanceof Error && error.message.includes(`Simulated`)) {
        return json(
          { error: `Network error - please try again` },
          { status: 503 }
        )
      }
      return json({ error: `Failed to delete todo` }, { status: 500 })
    }
  },
})
