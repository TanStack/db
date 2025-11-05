export interface Todo {
  id: string
  text: string
  completed: boolean
  createdAt: Date
  updatedAt: Date
}

export interface TodoInput {
  text: string
  completed?: boolean
}

export interface TodoUpdate {
  text?: string
  completed?: boolean
}

// In-memory storage for the demo
const todosStore = new Map<string, Todo>()

// Helper function to generate IDs
function generateId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36)
}

export const todoService = {
  getAll(): Array<Todo> {
    return Array.from(todosStore.values()).sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
  },

  getById(id: string): Todo | undefined {
    return todosStore.get(id)
  },

  create(input: TodoInput): Todo {
    const now = new Date()
    const todo: Todo = {
      id: generateId(),
      text: input.text,
      completed: input.completed ?? false,
      createdAt: now,
      updatedAt: now,
    }
    todosStore.set(todo.id, todo)
    return todo
  },

  update(id: string, updates: TodoUpdate): Todo | null {
    const existing = todosStore.get(id)
    if (!existing) {
      return null
    }

    const updated: Todo = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    }
    todosStore.set(id, updated)
    return updated
  },

  delete(id: string): boolean {
    return todosStore.delete(id)
  },

  clear(): void {
    todosStore.clear()
  },

  // For demo purposes - simulate network delays
  async withDelay<T>(fn: () => T, delay = 500): Promise<T> {
    await new Promise((resolve) => setTimeout(resolve, delay))
    return fn()
  },

  // For demo purposes - simulate random failures
  simulateFailure(probability = 0.2): void {
    if (Math.random() < probability) {
      throw new Error(`Simulated network failure`)
    }
  },
}

// Add some initial data for demo
todoService.create({ text: `Learn TanStack DB` })
todoService.create({ text: `Build offline-first app` })
todoService.create({ text: `Test multi-tab coordination`, completed: true })
