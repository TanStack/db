import { createServerFileRoute } from "@tanstack/react-start/server"
import { json } from "@tanstack/react-start"
import type { TodoInput } from "~/utils/todos"
import { todoService } from "~/utils/todos"

export const ServerRoute = createServerFileRoute(`/api/todos`).methods({
  GET: async ({ request }) => {
    console.info(`GET /api/todos @`, request.url)

    try {
      const todos = await todoService.withDelay(() => {
        // Occasionally simulate failure for demo
        todoService.simulateFailure(0.1)
        return todoService.getAll()
      })

      return json(todos)
    } catch (error) {
      console.error(`Error fetching todos:`, error)
      return json({ error: `Failed to fetch todos` }, { status: 500 })
    }
  },

  POST: async ({ request }) => {
    console.info(`POST /api/todos @`, request.url)

    try {
      const body = (await request.json()) as TodoInput

      if (!body.text || body.text.trim() === ``) {
        return json({ error: `Todo text is required` }, { status: 400 })
      }

      const todo = await todoService.withDelay(() => {
        // Occasionally simulate failure for demo
        todoService.simulateFailure(0.15)
        return todoService.create(body)
      })

      return json(todo, { status: 201 })
    } catch (error) {
      console.error(`Error creating todo:`, error)
      if (error instanceof Error && error.message.includes(`Simulated`)) {
        return json(
          { error: `Network error - please try again` },
          { status: 503 }
        )
      }
      return json({ error: `Failed to create todo` }, { status: 500 })
    }
  },
})
