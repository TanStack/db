import { Link, createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute(`/`)({
  component: HomePage,
})

function HomePage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
        <h1 className="text-3xl font-bold text-center mb-8 text-gray-800">
          TanStack React DB Demo
        </h1>

        <p className="text-gray-600 text-center mb-8">
          Choose a collection type to see how TanStack React DB works with
          different data sources:
        </p>

        <div className="space-y-4">
          <Link to="/query" className="block w-full">
            <button className="w-full px-6 py-4 bg-green-700 text-white rounded-lg hover:bg-green-800 transition-colors text-left">
              <div className="font-semibold">Query Collections</div>
              <div className="text-sm opacity-90 mt-1">
                Traditional polling with TanStack Query
              </div>
            </button>
          </Link>
          <Link to="/electric" className="block w-full">
            <button className="w-full px-6 py-4 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-left">
              <div className="font-semibold">Electric Collections</div>
              <div className="text-sm opacity-90 mt-1">
                Real-time sync with ElectricSQL
              </div>
            </button>
          </Link>
          <Link to="/trailbase" className="block w-full">
            <button className="w-full px-6 py-4 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-left">
              <div className="font-semibold">TrailBase Collections</div>
              <div className="text-sm opacity-90 mt-1">
                Real-time sync with TrailBase
              </div>
            </button>
          </Link>
        </div>

        <div className="mt-8 text-xs text-center text-gray-500">
          All examples use the same API and UI components, showcasing the
          unified interface of TanStack React DB.
        </div>
      </div>
    </div>
  )
}
