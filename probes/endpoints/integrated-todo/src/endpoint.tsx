import { z } from 'zod'
import { endpoints } from './runtime'
import { db, todo, requireUser, beforeWrite } from './database.server'
import { asc, eq, and, inArray } from 'drizzle-orm'
import { useLiveQuery, useDbClient } from '@tanstack/react-db'
import { count, eq as dbEq, type Transaction } from '@tanstack/db'
import { useEffect, useRef, useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import './style.css'
export function TodoApp() {
  const dbClient = useDbClient()
  const { query, mutation } = endpoints(dbClient)
  const listTodos = query({
    input: z.object({}),
    async handler(req, res) {
      const user = await requireUser(req)
      const todos = await db
        .select({
          id: todo.id,
          text: todo.text,
          completed: todo.completed,
          createdAt: todo.createdAt,
        })
        .from(todo)
        .where(eq(todo.userId, user.id))
        .orderBy(asc(todo.createdAt), asc(todo.id))
      return res.json(todos)
    },
  })
  const addTodo = mutation({
    input: z.object({
      id: z.string().uuid(),
      text: z.string().trim().min(1),
    }),
    onMutate({ input }) {
      listTodos.insert({
        id: input.id,
        text: input.text,
        completed: false,
        createdAt: new Date(),
      })
    },
    async handler(req, res) {
      const user = await requireUser(req)
      await beforeWrite()
      const { id, text } = req.body
      const [created] = await db
        .insert(todo)
        .values({ id, userId: user.id, text, completed: false })
        .returning({
          id: todo.id,
          text: todo.text,
          completed: todo.completed,
          createdAt: todo.createdAt,
        })
      return res.json(created)
    },
  })
  const editTodo = mutation({
    input: z.object({
      id: z.string().uuid(),
      text: z.string().trim().min(1),
    }),
    onMutate({ input }) {
      listTodos.update(input.id, (draft) => {
        draft.text = input.text
      })
    },
    async handler(req, res) {
      const user = await requireUser(req)
      await beforeWrite()
      await db
        .update(todo)
        .set({ text: req.body.text })
        .where(and(eq(todo.userId, user.id), eq(todo.id, req.body.id)))
      return res.json({ ok: true })
    },
  })
  const setCompleted = mutation({
    input: z.object({
      ids: z.array(z.string().uuid()).min(1),
      completed: z.boolean(),
    }),
    onMutate({ input }) {
      listTodos.update(input.ids, (drafts) => {
        for (const draft of drafts) draft.completed = input.completed
      })
    },
    async handler(req, res) {
      const user = await requireUser(req)
      await beforeWrite()
      await db
        .update(todo)
        .set({ completed: req.body.completed })
        .where(and(eq(todo.userId, user.id), inArray(todo.id, req.body.ids)))
      return res.json({ ok: true })
    },
  })
  const deleteTodos = mutation({
    input: z.object({ ids: z.array(z.string().uuid()).min(1) }),
    onMutate({ input }) {
      listTodos.delete(input.ids)
    },
    async handler(req, res) {
      const user = await requireUser(req)
      await beforeWrite()
      await db
        .delete(todo)
        .where(and(eq(todo.userId, user.id), inArray(todo.id, req.body.ids)))
      return res.json({ ok: true })
    },
  })
  const hash = useRouterState({ select: (state) => state.location.hash })
  const filter =
    hash === '/active' ? 'active' : hash === '/completed' ? 'completed' : 'all'
  const { data: todos, isReady } = useLiveQuery(
    (q) => {
      const rows = q.from({ todo: listTodos })
      const filtered =
        filter === 'all'
          ? rows
          : rows.where(({ todo }) =>
              dbEq(todo.completed, filter === 'completed'),
            )
      return filtered
        .orderBy(({ todo }) => todo.createdAt, 'asc')
        .orderBy(({ todo }) => todo.id, 'asc')
    },
    [listTodos, filter],
  )
  const { data: active } = useLiveQuery(
    (q) =>
      q
        .from({ todo: listTodos })
        .where(({ todo }) => dbEq(todo.completed, false))
        .select(({ todo }) => ({ id: todo.id })),
    [listTodos],
  )
  const { data: completed } = useLiveQuery(
    (q) =>
      q
        .from({ todo: listTodos })
        .where(({ todo }) => dbEq(todo.completed, true))
        .select(({ todo }) => ({ id: todo.id })),
    [listTodos],
  )
  const { data: counts } = useLiveQuery(
    (q) =>
      q
        .from({ todo: listTodos })
        .where(({ todo }) => dbEq(todo.completed, false))
        .select(({ todo }) => ({ active: count(todo.id) })),
    [listTodos],
  )
  const activeCount = counts[0]?.active ?? 0
  const [text, setText] = useState('')
  const [status, setStatus] = useState('Ready')
  const [errors, setErrors] = useState<Array<{ id: string; message: string }>>(
    [],
  )
  const inputRef = useRef<HTMLInputElement>(null)
  const pendingWrites = useRef(0)
  const writeError = useRef<string | null>(null)
  useEffect(() => {
    if (isReady) inputRef.current?.focus()
  }, [isReady])
  const [editingId, setEditingId] = useState<string | null>(null)
  const editing = useRef<string | null>(null)
  const [editText, setEditText] = useState('')

  function persist(action: () => Transaction) {
    if (pendingWrites.current === 0) writeError.current = null
    pendingWrites.current += 1
    setStatus('Saving')
    function settled(error?: unknown) {
      pendingWrites.current -= 1
      if (error !== undefined) {
        const message = error instanceof Error ? error.message : String(error)
        writeError.current = message
        setErrors((current) => [
          ...current,
          { id: crypto.randomUUID(), message },
        ])
      }
      setStatus(
        pendingWrites.current > 0
          ? 'Saving'
          : writeError.current
            ? 'Save failed'
            : 'Saved',
      )
    }
    try {
      const transaction = action()
      void transaction.isPersisted.promise.then(() => settled(), settled)
    } catch (error) {
      settled(error)
    }
  }
  function stopEditing() {
    editing.current = null
    setEditingId(null)
  }
  function saveEdit() {
    const id = editing.current
    if (id === null) return
    stopEditing()
    const next = editText.trim()
    if (!next) void persist(() => deleteTodos({ ids: [id] }))
    else if (next !== listTodos.get(id)?.text)
      void persist(() => editTodo({ id, text: next }))
  }
  return (
    <main>
      <header>
        <span className="eyebrow">FIELD NOTES / 01</span>
        <span className="scope">
          {dbClient.requireDependency<string>('endpointScope')}'s notebook
        </span>
      </header>
      <h1>
        A little less
        <br />
        <em>left to do.</em>
      </h1>
      <p className="intro">Write it down. Make room for what’s next.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          const next = text.trim()
          if (!next) return
          setText('')
          void persist(() => addTodo({ id: crypto.randomUUID(), text: next }))
        }}
      >
        <label htmlFor="todo-input">One thing to do</label>
        <div className="entry">
          <input
            id="todo-input"
            ref={inputRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="What’s on your mind?"
            required
            disabled={!isReady}
          />
          <button disabled={!isReady}>
            Add task <span>↗</span>
          </button>
        </div>
      </form>
      <div className="list-heading">
        <h2>Your list</h2>
        <output id="status" aria-live="polite">
          {status}
        </output>
      </div>
      <div
        className="list-tools"
        hidden={active.length + completed.length === 0}
      >
        <label className="toggle-all">
          <input
            type="checkbox"
            aria-label="Toggle all"
            ref={(input) => {
              if (input)
                input.indeterminate = active.length > 0 && completed.length > 0
            }}
            checked={active.length === 0 && completed.length > 0}
            disabled={active.length + completed.length === 0}
            onChange={() => {
              const target = active.length > 0 ? active : completed
              if (target.length)
                void persist(() =>
                  setCompleted({
                    ids: target.map((row) => row.id),
                    completed: active.length > 0,
                  }),
                )
            }}
          />
          Complete all
        </label>
        <nav aria-label="Filter tasks">
          {(['all', 'active', 'completed'] as const).map((value) => (
            <Link
              key={value}
              to="/"
              search={true}
              hash={value === 'all' ? '/' : `/${value}`}
              className={filter === value ? 'selected' : ''}
              aria-current={filter === value ? 'page' : undefined}
            >
              {value[0].toUpperCase() + value.slice(1)}
            </Link>
          ))}
        </nav>
      </div>
      <ul>
        {todos.map((row) => (
          <li
            key={row.id}
            data-id={row.id}
            className={[
              row.completed ? 'completed' : '',
              editingId === row.id ? 'editing' : '',
            ].join(' ')}
          >
            <input
              type="checkbox"
              aria-label={`Complete ${row.text}`}
              hidden={editingId === row.id}
              checked={row.completed}
              onChange={(event) => {
                void persist(() =>
                  setCompleted({
                    ids: [row.id],
                    completed: event.target.checked,
                  }),
                )
              }}
            />
            {editingId === row.id ? (
              <input
                autoFocus
                aria-label="Edit task"
                className="edit-input"
                value={editText}
                onChange={(event) => setEditText(event.target.value)}
                onBlur={saveEdit}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    saveEdit()
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    stopEditing()
                  }
                }}
              />
            ) : (
              <button
                type="button"
                className="todo-text"
                onDoubleClick={() => {
                  editing.current = row.id
                  setEditingId(row.id)
                  setEditText(row.text)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === 'F2') {
                    event.preventDefault()
                    editing.current = row.id
                    setEditingId(row.id)
                    setEditText(row.text)
                  }
                }}
              >
                {row.text}
              </button>
            )}
            <button
              type="button"
              className="delete-task"
              aria-label="Delete task"
              hidden={editingId === row.id}
              onClick={() => {
                void persist(() => deleteTodos({ ids: [row.id] }))
              }}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      {isReady && todos.length === 0 && (
        <p className="empty">
          {filter === 'all'
            ? 'A clean page. Start with one small thing.'
            : `No ${filter} tasks.`}
        </p>
      )}
      <div
        className="list-summary"
        hidden={active.length + completed.length === 0}
      >
        <span>
          <strong>{activeCount}</strong> {activeCount === 1 ? 'item' : 'items'}{' '}
          left
        </span>
        <button
          type="button"
          hidden={completed.length === 0}
          onClick={() => {
            if (completed.length)
              void persist(() =>
                deleteTodos({ ids: completed.map((row) => row.id) }),
              )
          }}
        >
          Clear completed
        </button>
      </div>
      <p className="editing-hint">
        Double-click a task to edit. Enter saves; Escape cancels.
      </p>
      <footer>
        ONE COMPONENT · ENDPOINTS PROTOTYPE
        <a
          href={`/?scope=${dbClient.requireDependency<string>('endpointScope') === 'alice' ? 'bob' : 'alice'}`}
        >
          Open{' '}
          {dbClient.requireDependency<string>('endpointScope') === 'alice'
            ? 'Bob'
            : 'Alice'}
          ’s notebook →
        </a>
      </footer>
      <div className="error-toasts" aria-label="Save errors">
        {errors.map((error) => (
          <div key={error.id} className="error-toast" role="alert">
            <div>
              <strong>Couldn’t save your change</strong>
              <p>{error.message}</p>
            </div>
            <button
              type="button"
              aria-label="Dismiss error"
              onClick={() => {
                setErrors((current) =>
                  current.filter((item) => item.id !== error.id),
                )
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </main>
  )
}
