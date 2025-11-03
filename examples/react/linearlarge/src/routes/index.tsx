import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: HomePage,
})

function HomePage() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">LinearLite</h1>
        <p className="text-lg text-gray-600 mb-8">
          A modern issue tracker built with TanStack Start & TanStack DB
        </p>
        <div className="space-x-4">
          <a
            href="/issues"
            className="px-6 py-3 bg-primary text-white rounded-lg hover:opacity-90 transition"
          >
            View Issues
          </a>
          <a
            href="/board"
            className="px-6 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
          >
            View Board
          </a>
        </div>
      </div>
    </div>
  )
}
