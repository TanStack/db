export function QueryDrivenSync() {
  return (
    <>
      <section className="hero" style={{ paddingTop: '4rem' }}>
        <div className="container">
          <h1>Query-Driven Sync</h1>
          <p className="tagline">
            Load data on-demand based on your live queries
          </p>
          <p className="subtitle">
            Version 0.5 introduces Query-Driven Sync, a major milestone on the pathway to 1.0.
            Now your component's query automatically becomes efficient API requests.
          </p>
        </div>
      </section>

      <section className="code-section">
        <div className="container">
          <h2>The Problem We're Solving</h2>
          <p className="description">
            Today most teams face an ugly fork in the road:
          </p>
          <div className="feature-grid" style={{ marginTop: '3rem' }}>
            <div className="feature-card">
              <h3>Option A: View-Specific APIs</h3>
              <p>
                Fast render, slow network, endless endpoint sprawl. Every new view needs a new endpoint,
                leading to backend complexity and maintenance nightmares.
              </p>
            </div>
            <div className="feature-card">
              <h3>Option B: Load-Everything-and-Filter</h3>
              <p>
                Simple backend, sluggish client. Loading entire collections works for small datasets
                but becomes painfully slow as your data grows.
              </p>
            </div>
            <div className="feature-card" style={{ gridColumn: '1 / -1', background: 'linear-gradient(135deg, rgba(229, 53, 171, 0.1), rgba(0, 216, 255, 0.1))' }}>
              <h3>Option C: Query-Driven Sync</h3>
              <p>
                DB's differential dataflow unlocks a third option—load normalized collections on-demand,
                let TanStack DB stream millisecond-level incremental joins in the browser.
                No rewrites, no spinners, no jitter.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="highlight-section">
        <div className="container">
          <h2>How It Works</h2>
          <div className="highlight-content">
            <p>
              With Query-Driven Sync, your component's live query automatically determines what data to fetch.
            </p>
          </div>
        </div>
      </section>

      <section className="code-section" style={{ background: 'var(--color-background)' }}>
        <div className="container">
          <h2>A Simple Example</h2>
          <p className="description">
            Let's see how Query-Driven Sync works with the TanStack Query Collection.
          </p>

          <div style={{ marginBottom: '3rem' }}>
            <h3 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>Step 1: Define Your Collection</h3>
            <p style={{ color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
              First, create a collection that wraps your existing data fetching:
            </p>
            <div className="code-block">
              <pre><code>{`import { createCollection } from "@tanstack/react-db"
import { queryCollection } from "@tanstack/query-db-collection"

const productsCollection = createCollection(queryCollection({
  id: 'products',
  queryFn: async () => {
    return api.getProducts()
  },
  getKey: (product) => product.id,
}))`}</code></pre>
            </div>
            <p style={{ color: 'var(--color-text-muted)', marginTop: '1rem' }}>
              This holds the response from <code>getProducts()</code> as a map. You can call{' '}
              <code>productsCollection.get('123')</code> to get a product.
            </p>
          </div>

          <div style={{ marginBottom: '3rem' }}>
            <h3 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>Step 2: Query Your Data</h3>
            <p style={{ color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
              Now run a live query against your collection:
            </p>
            <div className="code-block">
              <pre><code>{`import { useLiveQuery } from "@tanstack/react-db"

function Products() {
  const { data: expensiveProducts } = useLiveQuery(q => q
    .from({ products: productsCollection })
    .where(({ products }) => gte(products.price, 25.0))
  )

  return (
    <div>
      {expensiveProducts.map(product => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  )
}`}</code></pre>
            </div>
            <p style={{ color: 'var(--color-text-muted)', marginTop: '1rem' }}>
              This works great if the number of products is small enough that your API can return them quickly.
              But what happens when you have thousands or millions of products?
            </p>
          </div>

          <div style={{ marginBottom: '3rem' }}>
            <h3 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>Step 3: Enable Query-Driven Sync</h3>
            <p style={{ color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
              Simply add the <code>syncMode: "on-demand"</code> option:
            </p>
            <div className="code-block">
              <pre><code>{`const productsCollection = createCollection(queryCollection({
  id: 'products',
  queryFn: async () => {
    return api.getProducts()
  },
  getKey: (product) => product.id,
  syncMode: 'on-demand', // 🎯 Enable Query-Driven Sync
}))`}</code></pre>
            </div>
            <p style={{ color: 'var(--color-text-muted)', marginTop: '1rem' }}>
              Now your <code>queryFn</code> will be called separately for <strong>every query</strong>, with the query parameters automatically extracted.
            </p>
          </div>

          <div style={{ marginBottom: '3rem' }}>
            <h3 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>The Magic: Automatic Query Translation</h3>
            <p style={{ color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
              Your live query is automatically analyzed and converted into efficient API requests:
            </p>
            <div className="two-column">
              <div>
                <h4 style={{ marginBottom: '1rem', color: 'var(--color-primary)' }}>Your Query</h4>
                <div className="code-block">
                  <pre><code>{`useLiveQuery(q => q
  .from({ products })
  .where(({ products }) =>
    gte(products.price, 25.0)
  )
)`}</code></pre>
                </div>
              </div>
              <div>
                <h4 style={{ marginBottom: '1rem', color: 'var(--color-secondary)' }}>Becomes</h4>
                <div className="code-block">
                  <pre><code>{`GET /api/products?price_gte=25.0`}</code></pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="highlight-section">
        <div className="container">
          <h2>Join Queries Work Too</h2>
          <div className="highlight-content">
            <p>
              Query-Driven Sync really shines with joins. Here's a more complex example:
            </p>
            <div className="code-block" style={{ marginTop: '2rem', marginBottom: '2rem' }}>
              <pre><code>{`// Your live query with a join
const { data: projectTodos } = useLiveQuery((q) =>
  q.from({ todos })
    .join({ projects }, ({ todos, projects }) =>
      eq(todos.projectId, projects.id)
    )
)

// Automatically becomes two efficient API calls:
GET /api/projects/123
GET /api/todos?projectId=123`}</code></pre>
            </div>
            <p>
              TanStack DB analyzes your join conditions and fetches exactly the data you need.
              The join is then performed client-side in <strong>sub-millisecond time</strong> using differential dataflow.
            </p>
          </div>
        </div>
      </section>

      <section className="code-section">
        <div className="container">
          <h2>Key Benefits</h2>
          <div className="feature-grid">
            <div className="feature-card">
              <h3>⚡ Load Only What You Need</h3>
              <p>
                No more loading entire tables into memory. Fetch data on-demand based on your queries.
              </p>
            </div>
            <div className="feature-card">
              <h3>🎯 Simple Backend</h3>
              <p>
                Keep your API endpoints generic. No need to create custom endpoints for every view.
              </p>
            </div>
            <div className="feature-card">
              <h3>🚀 Incremental Adoption</h3>
              <p>
                Works with your existing TanStack Query setup. Just add <code>syncMode: "on-demand"</code>.
              </p>
            </div>
            <div className="feature-card">
              <h3>🔄 Automatic Caching</h3>
              <p>
                Data is cached in your collections. Subsequent queries reuse cached data for instant results.
              </p>
            </div>
            <div className="feature-card">
              <h3>💪 Type Safe</h3>
              <p>
                Full TypeScript support with inferred types from your schema and queries.
              </p>
            </div>
            <div className="feature-card">
              <h3>🎨 Flexible</h3>
              <p>
                Works with any backend that supports query parameters. REST, GraphQL, or custom APIs.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="hero" style={{ paddingTop: '4rem', paddingBottom: '6rem', background: 'var(--color-background)' }}>
        <div className="container">
          <h2 style={{ fontSize: '2.5rem', marginBottom: '1.5rem' }}>Live Queries, Effortless Optimistic Writes</h2>
          <p className="subtitle" style={{ marginBottom: '2rem' }}>
            Query-Driven Sync is just one part of TanStack DB's radically simpler architecture.
            Combine it with optimistic mutations, fine-grained reactivity, and differential dataflow
            for the best developer experience.
          </p>
          <div className="btn-group">
            <a href="https://tanstack.com/db/latest/docs/overview" className="btn btn-primary">
              Read the Full Documentation
            </a>
            <a
              href="https://github.com/TanStack/db/issues/612"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary"
            >
              View the RFC
            </a>
          </div>
        </div>
      </section>
    </>
  )
}
