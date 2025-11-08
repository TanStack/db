import { Link } from 'react-router-dom'

export function Home() {
  return (
    <>
      <section className="hero">
        <div className="container">
          <h1>TanStack DB</h1>
          <p className="tagline">
            A client-side database for your API
          </p>
          <p className="subtitle">
            Colocated reactive queries, effortless optimistic mutations, and <strong>Collections</strong> that wrap your existing useQuery calls or sync engines.
          </p>
          <div className="btn-group">
            <Link to="/learn" className="btn btn-primary">
              Get Started
            </Link>
            <Link to="/query-driven-sync" className="btn btn-secondary">
              Query-Driven Sync →
            </Link>
          </div>
        </div>
      </section>

      <section className="features">
        <div className="container">
          <h2>Why TanStack DB?</h2>
          <div className="feature-grid">
            <div className="feature-card">
              <h3>⚡ Blazing Fast</h3>
              <p>
                Sub-millisecond live queries, joins & aggregates powered by differential dataflow.
                Your UI stays instantly reactive without the overhead.
              </p>
            </div>
            <div className="feature-card">
              <h3>🎯 Fine-Grained Reactivity</h3>
              <p>
                Minimize component re-rendering with precise, granular updates.
                Only the data that changed triggers a re-render.
              </p>
            </div>
            <div className="feature-card">
              <h3>🔄 Optimistic Mutations</h3>
              <p>
                Robust transaction primitives for optimistic updates with sync & lifecycle support.
                Build snappy UIs that feel instant.
              </p>
            </div>
            <div className="feature-card">
              <h3>📦 Normalized Data</h3>
              <p>
                Keep your backend simple and consistent with normalized collections.
                No more endpoint sprawl or N+1 queries.
              </p>
            </div>
            <div className="feature-card">
              <h3>🔌 Backend Agnostic</h3>
              <p>
                Works with any sync engine or data source. Use TanStack Query, Electric SQL,
                RxDB, PowerSync, or build your own.
              </p>
            </div>
            <div className="feature-card">
              <h3>📈 Query-Driven Sync</h3>
              <p>
                NEW! Load data on-demand based on your live queries. Perfect for large datasets
                that can't fit in memory.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="code-section">
        <div className="container">
          <h2>Simple, Powerful Queries</h2>
          <p className="description">
            Write reactive queries that automatically update your UI when data changes.
          </p>
          <div className="code-block">
            <pre><code>{`// Join todos and projects collections
const { data: projectTodos } = useLiveQuery((q) =>
  q.from({ todos })
    .join({ projects }, ({ todos, projects }) =>
      eq(todos.projectId, projects.id)
    )
)

// Filter, sort, and paginate
const { data: completedTodos } = useLiveQuery((q) =>
  q.from({ todos })
    .where(({ todos }) => eq(todos.completed, true))
    .orderBy(({ todos }) => desc(todos.createdAt))
    .limit(10)
)`}</code></pre>
          </div>
        </div>
      </section>

      <section className="highlight-section">
        <div className="container">
          <h2>Introducing Query-Driven Sync</h2>
          <div className="highlight-content">
            <p>
              Version 0.5 introduces <strong>Query-Driven Sync</strong>, a major milestone on the pathway to 1.0.
            </p>
            <p>
              Your component's live query automatically becomes efficient API requests:
            </p>
            <div className="code-block" style={{ marginTop: '2rem', marginBottom: '2rem' }}>
              <pre><code>{`// Your live query
const { data: projectTodos } = useLiveQuery((q) =>
  q.from({ todos })
    .join({ projects }, ({ todos, projects }) =>
      eq(todos.projectId, projects.id)
    )
)

// Automatically becomes:
GET /api/projects/123
GET /api/todos?projectId=123`}</code></pre>
            </div>
            <p>
              Most teams face an ugly fork in the road: <strong>view-specific APIs</strong> (fast render, slow network, endless endpoint sprawl)
              or <strong>load-everything-and-filter</strong> (simple backend, sluggish client).
            </p>
            <p>
              DB's differential dataflow unlocks <strong>Option C</strong>—load normalized collections on-demand,
              let TanStack DB stream millisecond-level incremental joins in the browser.
              No rewrites, no spinners, no jitter.
            </p>
            <div className="btn-group" style={{ marginTop: '3rem' }}>
              <Link to="/query-driven-sync" className="btn btn-primary">
                Learn More About Query-Driven Sync
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="code-section">
        <div className="container">
          <h2>Optimistic Mutations Made Easy</h2>
          <p className="description">
            Update your UI instantly while syncing with your backend.
          </p>
          <div className="code-block">
            <pre><code>{`const addTodo = createOptimisticAction({
  action: async (newTodo) => {
    // Optimistically add to collection
    todosCollection.add(newTodo)

    // Sync with backend
    await api.createTodo(newTodo)
  },
  rollback: (newTodo) => {
    // Automatically rollback on error
    todosCollection.remove(newTodo.id)
  }
})

// UI updates instantly, syncs in background
await addTodo({
  title: 'New todo',
  completed: false
})`}</code></pre>
          </div>
        </div>
      </section>

      <section className="features" style={{ background: 'var(--color-background)' }}>
        <div className="container">
          <h2>Framework Support</h2>
          <div className="feature-grid">
            <div className="feature-card">
              <h3>⚛️ React</h3>
              <p>First-class React support with hooks like useLiveQuery for reactive data.</p>
            </div>
            <div className="feature-card">
              <h3>🔺 Vue</h3>
              <p>Vue composables for seamless integration with your Vue applications.</p>
            </div>
            <div className="feature-card">
              <h3>🔷 Solid</h3>
              <p>SolidJS primitives for fine-grained reactive updates.</p>
            </div>
            <div className="feature-card">
              <h3>🅰️ Angular</h3>
              <p>Angular services and injection patterns for type-safe queries.</p>
            </div>
            <div className="feature-card">
              <h3>🔶 Svelte</h3>
              <p>Svelte stores for reactive data management.</p>
            </div>
            <div className="feature-card">
              <h3>📦 Framework Agnostic</h3>
              <p>Core library works with any JavaScript framework.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="hero" style={{ paddingTop: '4rem', paddingBottom: '6rem' }}>
        <div className="container">
          <h2 style={{ fontSize: '2.5rem', marginBottom: '1.5rem' }}>Ready to Get Started?</h2>
          <p className="subtitle" style={{ marginBottom: '2rem' }}>
            Install TanStack DB and start building faster, more reactive applications today.
          </p>
          <div className="code-block" style={{ maxWidth: '600px', margin: '0 auto 2rem', textAlign: 'left' }}>
            <pre><code>npm install @tanstack/react-db</code></pre>
          </div>
          <div className="btn-group">
            <Link to="/learn" className="btn btn-primary">
              Read the Docs
            </Link>
            <a
              href="https://github.com/TanStack/db"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary"
            >
              View on GitHub
            </a>
          </div>
        </div>
      </section>
    </>
  )
}
