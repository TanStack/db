export function Learn() {
  return (
    <>
      <section className="hero" style={{ paddingTop: '4rem' }}>
        <div className="container">
          <h1>Learn TanStack DB</h1>
          <p className="tagline">
            Get started with the client-side database for modern apps
          </p>
        </div>
      </section>

      <section className="code-section">
        <div className="container">
          <h2>Quick Start</h2>
          <div style={{ marginBottom: '3rem' }}>
            <h3 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>Installation</h3>
            <div className="code-block">
              <pre><code>{`# React
npm install @tanstack/react-db

# Vue
npm install @tanstack/vue-db

# Solid
npm install @tanstack/solid-db

# Svelte
npm install @tanstack/svelte-db

# Angular
npm install @tanstack/angular-db`}</code></pre>
            </div>
          </div>

          <div style={{ marginBottom: '3rem' }}>
            <h3 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>Create Your First Collection</h3>
            <p style={{ color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
              Collections are the core building block of TanStack DB. They hold normalized data that you can query reactively.
            </p>
            <div className="code-block">
              <pre><code>{`import { createCollection } from "@tanstack/react-db"
import { queryCollection } from "@tanstack/query-db-collection"

// Define your collection
const todosCollection = createCollection(queryCollection({
  id: 'todos',
  queryFn: async () => {
    const response = await fetch('/api/todos')
    return response.json()
  },
  getKey: (todo) => todo.id,
}))`}</code></pre>
            </div>
          </div>

          <div style={{ marginBottom: '3rem' }}>
            <h3 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>Run Live Queries</h3>
            <p style={{ color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
              Use <code>useLiveQuery</code> to query your collections reactively. Your component will automatically update when the underlying data changes.
            </p>
            <div className="code-block">
              <pre><code>{`import { useLiveQuery } from "@tanstack/react-db"
import { eq } from "@tanstack/db"

function TodoList() {
  // Query all incomplete todos
  const { data: incompleteTodos } = useLiveQuery((q) =>
    q.from({ todos: todosCollection })
      .where(({ todos }) => eq(todos.completed, false))
  )

  return (
    <ul>
      {incompleteTodos.map(todo => (
        <li key={todo.id}>{todo.title}</li>
      ))}
    </ul>
  )
}`}</code></pre>
            </div>
          </div>

          <div style={{ marginBottom: '3rem' }}>
            <h3 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>Optimistic Mutations</h3>
            <p style={{ color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
              Create optimistic actions that update your UI instantly while syncing with your backend.
            </p>
            <div className="code-block">
              <pre><code>{`import { createOptimisticAction } from "@tanstack/react-db"

const addTodo = createOptimisticAction({
  action: async (newTodo) => {
    // Optimistically add to collection
    todosCollection.add(newTodo)

    // Sync with backend
    const response = await fetch('/api/todos', {
      method: 'POST',
      body: JSON.stringify(newTodo)
    })
    return response.json()
  },
  rollback: (newTodo) => {
    // Automatically rollback on error
    todosCollection.remove(newTodo.id)
  }
})

// Use in your component
await addTodo({
  id: crypto.randomUUID(),
  title: 'New todo',
  completed: false
})`}</code></pre>
            </div>
          </div>
        </div>
      </section>

      <section className="features">
        <div className="container">
          <h2>Core Concepts</h2>
          <div className="feature-grid">
            <div className="feature-card">
              <h3>Collections</h3>
              <p>
                Normalized data stores that hold your entities. Can be backed by TanStack Query,
                Electric SQL, RxDB, PowerSync, or custom sync engines.
              </p>
            </div>
            <div className="feature-card">
              <h3>Live Queries</h3>
              <p>
                Reactive queries that automatically update when underlying data changes.
                Supports filtering, sorting, joins, and aggregations.
              </p>
            </div>
            <div className="feature-card">
              <h3>Optimistic Actions</h3>
              <p>
                Update your UI instantly while syncing with your backend.
                Automatic rollback on errors with full lifecycle support.
              </p>
            </div>
            <div className="feature-card">
              <h3>Transactions</h3>
              <p>
                Group multiple mutations into atomic transactions with full ACID guarantees
                for optimistic updates.
              </p>
            </div>
            <div className="feature-card">
              <h3>Query-Driven Sync</h3>
              <p>
                Load data on-demand based on your live queries. Perfect for large datasets
                that can't fit in memory.
              </p>
            </div>
            <div className="feature-card">
              <h3>Differential Dataflow</h3>
              <p>
                Incrementally maintain query results as data changes.
                Sub-millisecond updates even with complex joins.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="code-section" style={{ background: 'var(--color-background)' }}>
        <div className="container">
          <h2>Collection Types</h2>
          <p className="description">
            Choose the collection type that fits your needs
          </p>
          <div className="feature-grid">
            <div className="feature-card">
              <h3>Query Collection</h3>
              <p>
                Wrap your existing TanStack Query calls. Works with any REST API or data fetching library.
              </p>
              <div className="code-block" style={{ marginTop: '1rem', fontSize: '0.85rem' }}>
                <pre><code>{`queryCollection({
  id: 'todos',
  queryFn: async () => api.getTodos()
})`}</code></pre>
              </div>
            </div>
            <div className="feature-card">
              <h3>Electric Collection</h3>
              <p>
                Real-time sync with Electric SQL. Automatic bidirectional sync with your Postgres database.
              </p>
              <div className="code-block" style={{ marginTop: '1rem', fontSize: '0.85rem' }}>
                <pre><code>{`electricCollection({
  electric,
  tableName: 'todos'
})`}</code></pre>
              </div>
            </div>
            <div className="feature-card">
              <h3>RxDB Collection</h3>
              <p>
                Integrate with RxDB for offline-first applications with full replication support.
              </p>
              <div className="code-block" style={{ marginTop: '1rem', fontSize: '0.85rem' }}>
                <pre><code>{`rxdbCollection({
  collection: rxdbTodos
})`}</code></pre>
              </div>
            </div>
            <div className="feature-card">
              <h3>PowerSync Collection</h3>
              <p>
                Use PowerSync for local-first apps with conflict-free replication.
              </p>
              <div className="code-block" style={{ marginTop: '1rem', fontSize: '0.85rem' }}>
                <pre><code>{`powerSyncCollection({
  db: powerSyncDb,
  tableName: 'todos'
})`}</code></pre>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="hero" style={{ paddingTop: '4rem', paddingBottom: '6rem' }}>
        <div className="container">
          <h2 style={{ fontSize: '2.5rem', marginBottom: '1.5rem' }}>Ready to Dive Deeper?</h2>
          <p className="subtitle" style={{ marginBottom: '2rem' }}>
            Check out the full documentation for advanced topics, API reference, and more examples.
          </p>
          <div className="btn-group">
            <a href="https://tanstack.com/db/latest/docs/overview" className="btn btn-primary">
              Full Documentation
            </a>
            <a
              href="https://github.com/TanStack/db/tree/main/examples"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary"
            >
              View Examples
            </a>
          </div>
        </div>
      </section>
    </>
  )
}
