export function Code() {
  return (
    <>
      <section className="hero" style={{ paddingTop: '4rem' }}>
        <div className="container">
          <h1>Code & Tools</h1>
          <p className="tagline">
            Libraries, tools, and services for TanStack DB
          </p>
        </div>
      </section>

      <section className="features">
        <div className="container">
          <h2>Official Packages</h2>
          <div className="feature-grid">
            <div className="feature-card">
              <h3>@tanstack/db</h3>
              <p>
                Core library with the query engine, collection primitives, and differential dataflow implementation.
                Framework agnostic.
              </p>
              <a
                href="https://www.npmjs.com/package/@tanstack/db"
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-block', marginTop: '1rem' }}
              >
                View on npm →
              </a>
            </div>
            <div className="feature-card">
              <h3>@tanstack/react-db</h3>
              <p>
                React adapter with hooks like <code>useLiveQuery</code> for reactive data queries in React applications.
              </p>
              <a
                href="https://www.npmjs.com/package/@tanstack/react-db"
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-block', marginTop: '1rem' }}
              >
                View on npm →
              </a>
            </div>
            <div className="feature-card">
              <h3>@tanstack/vue-db</h3>
              <p>
                Vue composables for integrating TanStack DB with Vue 3 applications.
              </p>
              <a
                href="https://www.npmjs.com/package/@tanstack/vue-db"
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-block', marginTop: '1rem' }}
              >
                View on npm →
              </a>
            </div>
            <div className="feature-card">
              <h3>@tanstack/solid-db</h3>
              <p>
                SolidJS primitives for fine-grained reactive updates with TanStack DB.
              </p>
              <a
                href="https://www.npmjs.com/package/@tanstack/solid-db"
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-block', marginTop: '1rem' }}
              >
                View on npm →
              </a>
            </div>
            <div className="feature-card">
              <h3>@tanstack/svelte-db</h3>
              <p>
                Svelte stores for reactive data management with TanStack DB.
              </p>
              <a
                href="https://www.npmjs.com/package/@tanstack/svelte-db"
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-block', marginTop: '1rem' }}
              >
                View on npm →
              </a>
            </div>
            <div className="feature-card">
              <h3>@tanstack/angular-db</h3>
              <p>
                Angular services and injection patterns for type-safe queries.
              </p>
              <a
                href="https://www.npmjs.com/package/@tanstack/angular-db"
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-block', marginTop: '1rem' }}
              >
                View on npm →
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="code-section">
        <div className="container">
          <h2>Collection Adapters</h2>
          <p className="description">
            Connect TanStack DB to your favorite sync engine or data source
          </p>
          <div className="feature-grid">
            <div className="feature-card">
              <h3>@tanstack/query-db-collection</h3>
              <p>
                Wrap your existing TanStack Query calls. Works with any REST API or data fetching library.
                Supports query-driven sync for on-demand loading.
              </p>
              <a
                href="https://www.npmjs.com/package/@tanstack/query-db-collection"
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-block', marginTop: '1rem' }}
              >
                View on npm →
              </a>
            </div>
            <div className="feature-card">
              <h3>@tanstack/electric-db-collection</h3>
              <p>
                Real-time sync with Electric SQL. Automatic bidirectional sync with your Postgres database
                using Electric's shape-based sync.
              </p>
              <a
                href="https://www.npmjs.com/package/@tanstack/electric-db-collection"
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-block', marginTop: '1rem' }}
              >
                View on npm →
              </a>
            </div>
            <div className="feature-card">
              <h3>@tanstack/rxdb-db-collection</h3>
              <p>
                Integrate with RxDB for offline-first applications with full replication support
                and automatic conflict resolution.
              </p>
              <a
                href="https://www.npmjs.com/package/@tanstack/rxdb-db-collection"
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-block', marginTop: '1rem' }}
              >
                View on npm →
              </a>
            </div>
            <div className="feature-card">
              <h3>@tanstack/powersync-db-collection</h3>
              <p>
                Use PowerSync for local-first apps with conflict-free replication from your backend database.
              </p>
              <a
                href="https://www.npmjs.com/package/@tanstack/powersync-db-collection"
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-block', marginTop: '1rem' }}
              >
                View on npm →
              </a>
            </div>
            <div className="feature-card">
              <h3>@tanstack/trailbase-db-collection</h3>
              <p>
                Connect to TrailBase for a complete backend solution with authentication, storage, and real-time sync.
              </p>
              <a
                href="https://www.npmjs.com/package/@tanstack/trailbase-db-collection"
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-block', marginTop: '1rem' }}
              >
                View on npm →
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="features" style={{ background: 'var(--color-background)' }}>
        <div className="container">
          <h2>Developer Tools</h2>
          <div className="feature-grid">
            <div className="feature-card">
              <h3>TanStack DevTools</h3>
              <p>
                Debug your live queries, inspect collection state, and visualize data flow
                with the official TanStack DevTools.
              </p>
              <a
                href="https://tanstack.com/devtools"
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-block', marginTop: '1rem' }}
              >
                Learn more →
              </a>
            </div>
            <div className="feature-card">
              <h3>TypeScript Support</h3>
              <p>
                Full TypeScript support with inferred types from your schema and queries.
                Get autocomplete and type checking for your entire data layer.
              </p>
            </div>
            <div className="feature-card">
              <h3>ESLint Plugin</h3>
              <p>
                Coming soon: ESLint rules to catch common mistakes and enforce best practices
                when using TanStack DB.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="code-section">
        <div className="container">
          <h2>Examples & Templates</h2>
          <p className="description">
            Get started quickly with our example projects
          </p>
          <div className="feature-grid">
            <div className="feature-card">
              <h3>React Todo App</h3>
              <p>
                A complete todo application showing collections, live queries, and optimistic mutations.
              </p>
              <a
                href="https://github.com/TanStack/db/tree/main/examples/react/todo"
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-block', marginTop: '1rem' }}
              >
                View on GitHub →
              </a>
            </div>
            <div className="feature-card">
              <h3>Projects Dashboard</h3>
              <p>
                Multi-collection example with joins, showing how to build a projects and tasks dashboard.
              </p>
              <a
                href="https://github.com/TanStack/db/tree/main/examples/react/projects"
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-block', marginTop: '1rem' }}
              >
                View on GitHub →
              </a>
            </div>
            <div className="feature-card">
              <h3>Offline Transactions</h3>
              <p>
                Example showing offline-first transactions with automatic sync when back online.
              </p>
              <a
                href="https://github.com/TanStack/db/tree/main/examples/react/offline-transactions"
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-block', marginTop: '1rem' }}
              >
                View on GitHub →
              </a>
            </div>
            <div className="feature-card">
              <h3>Paced Mutations Demo</h3>
              <p>
                Advanced example showing rate-limited mutations with TanStack Pacer integration.
              </p>
              <a
                href="https://github.com/TanStack/db/tree/main/examples/react/paced-mutations-demo"
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-block', marginTop: '1rem' }}
              >
                View on GitHub →
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="hero" style={{ paddingTop: '4rem', paddingBottom: '6rem' }}>
        <div className="container">
          <h2 style={{ fontSize: '2.5rem', marginBottom: '1.5rem' }}>Build Something Amazing</h2>
          <p className="subtitle" style={{ marginBottom: '2rem' }}>
            Explore our examples, read the docs, and start building with TanStack DB today.
          </p>
          <div className="btn-group">
            <a
              href="https://github.com/TanStack/db/tree/main/examples"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary"
            >
              Browse Examples
            </a>
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
