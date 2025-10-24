import {
  bindToElement,
  createCollection,
  createLiveQuery,
  createTransaction,
  eq,
} from "@tanstack/html-db"

// Define Todo type
interface Todo {
  id: number
  text: string
  completed: boolean
  created_at: Date
}

// In-memory store for todos (simulating a backend)
const todoStore = new Map<number, Todo>()
let nextId = 1

// Initialize with some sample todos
const sampleTodos: Array<Omit<Todo, `id` | `created_at`>> = [
  { text: `Learn TanStack DB`, completed: false },
  { text: `Build a todo app with vanilla JS`, completed: false },
  { text: `Master reactive programming`, completed: false },
]

sampleTodos.forEach((todo) => {
  const newTodo: Todo = {
    ...todo,
    id: nextId++,
    created_at: new Date(),
  }
  todoStore.set(newTodo.id, newTodo)
})

// Create a collection with in-memory sync
const todosCollection = createCollection<Todo, number>({
  id: `todos`,
  getKey: (item) => item.id,
  initialData: Array.from(todoStore.values()),
  onInsert: ({ transaction }) => {
    const modified = transaction.mutations[0].modified
    const newTodo: Todo = {
      ...modified,
      id: nextId++,
      created_at: new Date(),
    }
    todoStore.set(newTodo.id, newTodo)
    return newTodo
  },
  onUpdate: ({ transaction }) => {
    transaction.mutations.forEach((mutation) => {
      const { original, changes } = mutation
      if (`id` in original) {
        const existing = todoStore.get(original.id)
        if (existing) {
          const updated = { ...existing, ...changes }
          todoStore.set(original.id, updated)
        }
      }
    })
  },
  onDelete: ({ transaction }) => {
    transaction.mutations.forEach((mutation) => {
      const { original } = mutation
      if (`id` in original) {
        todoStore.delete(original.id)
      }
    })
  },
})

// Start the collection
todosCollection.startSyncImmediate()

// Filter state
let currentFilter: `all` | `active` | `completed` = `all`

// Create filtered query
const createFilteredQuery = () => {
  return createLiveQuery((q) => {
    const query = q.from({ todos: todosCollection })

    if (currentFilter === `active`) {
      return query.where(({ todos }) => eq(todos.completed, false))
    } else if (currentFilter === `completed`) {
      return query.where(({ todos }) => eq(todos.completed, true))
    }

    return query
  })
}

// Create initial query
let filteredQuery = createFilteredQuery()

// Stats query (all todos for counting)
const statsQuery = createLiveQuery((q) => q.from({ todos: todosCollection }))

// Render functions
const renderTodoList = ({ data, isLoading }: any) => {
  if (isLoading) {
    return `<div class="loading">Loading todos...</div>`
  }

  if (!data || data.length === 0) {
    return `<div class="empty">No todos yet. Add one above!</div>`
  }

  return data
    .map(
      (todo: Todo) => `
      <li class="todo-item ${todo.completed ? `completed` : ``}" data-id="${todo.id}">
        <input
          type="checkbox"
          class="todo-checkbox"
          ${todo.completed ? `checked` : ``}
          data-id="${todo.id}"
        />
        <span class="todo-text">${escapeHtml(todo.text)}</span>
        <button class="delete-btn" data-id="${todo.id}">Delete</button>
      </li>
    `
    )
    .join(``)
}

const renderStats = ({ data }: any) => {
  if (!data) return ``

  const total = data.length
  const completed = data.filter((t: Todo) => t.completed).length
  const active = total - completed

  return `
    <strong>${total}</strong> total •
    <strong>${active}</strong> active •
    <strong>${completed}</strong> completed
  `
}

// Bind queries to DOM
let todoListCleanup = bindToElement(filteredQuery, `#todo-list`, renderTodoList)
bindToElement(statsQuery, `#stats`, renderStats)

// Event handlers
const todoInput = document.getElementById(`todo-input`) as HTMLInputElement
const addBtn = document.getElementById(`add-btn`) as HTMLButtonElement
const todoList = document.getElementById(`todo-list`) as HTMLUListElement

// Add todo
const addTodo = () => {
  const text = todoInput.value.trim()
  if (!text) return

  createTransaction({
    mutate: () => {
      todosCollection.insert({
        text,
        completed: false,
      } as Todo)
    },
  })

  todoInput.value = ``
  todoInput.focus()
}

addBtn.addEventListener(`click`, addTodo)
todoInput.addEventListener(`keypress`, (e) => {
  if (e.key === `Enter`) {
    addTodo()
  }
})

// Toggle todo
todoList.addEventListener(`click`, (e) => {
  const target = e.target as HTMLElement

  if (target.classList.contains(`todo-checkbox`)) {
    const id = Number(target.getAttribute(`data-id`))
    const todo = todosCollection.get(id)

    if (todo) {
      createTransaction({
        mutate: () => {
          todosCollection.update(id, (draft) => {
            draft.completed = !draft.completed
          })
        },
      })
    }
  }

  if (target.classList.contains(`delete-btn`)) {
    const id = Number(target.getAttribute(`data-id`))

    createTransaction({
      mutate: () => {
        todosCollection.delete(id)
      },
    })
  }
})

// Filter handling
const filterBtns = document.querySelectorAll(`.filter-btn`)

filterBtns.forEach((btn) => {
  btn.addEventListener(`click`, () => {
    const filter = btn.getAttribute(`data-filter`) as
      | `all`
      | `active`
      | `completed`

    // Update active state
    filterBtns.forEach((b) => b.classList.remove(`active`))
    btn.classList.add(`active`)

    // Update filter and recreate query
    currentFilter = filter

    // Clean up old query
    todoListCleanup()
    filteredQuery.destroy()

    // Create new query with new filter
    filteredQuery = createFilteredQuery()

    // Bind new query
    todoListCleanup = bindToElement(filteredQuery, `#todo-list`, renderTodoList)
  })
})

// Helper function to escape HTML
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, `&amp;`)
    .replace(/</g, `&lt;`)
    .replace(/>/g, `&gt;`)
    .replace(/"/g, `&quot;`)
    .replace(/'/g, `&#039;`)
}

// Log to console for debugging
console.log(`TanStack DB Todo App initialized!`)
console.log(`Collection:`, todosCollection)
console.log(`Filtered Query:`, filteredQuery)
console.log(`Stats Query:`, statsQuery)
