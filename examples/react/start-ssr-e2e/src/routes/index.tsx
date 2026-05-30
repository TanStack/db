import { Link, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute(`/`)({
  component: HomePage,
})

function HomePage() {
  return (
    <main style={{ padding: 32 }}>
      <h1>TanStack DB Start SSR E2E</h1>
      <Link to="/ssr-db">Open SSR DB route</Link>
    </main>
  )
}
