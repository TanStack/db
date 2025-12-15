import { Link, createFileRoute } from "@tanstack/solid-router"

export const Route = createFileRoute(`/`)({
  component: HomePage,
})

function HomePage() {
  return (
    <div class="min-h-screen flex items-center justify-center bg-gray-50">
      <div class="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
        <h1 class="text-3xl font-bold text-center mb-8 text-gray-800">
          TanStack Solid DB Demo
        </h1>

        <p class="text-gray-600 text-center mb-8">
          Choose a collection type to see how TanStack Solid DB works with
          different data sources:
        </p>

        <div class="space-y-4">
          <Link to="/query" class="block w-full">
            <button class="w-full px-6 py-4 bg-green-700 text-white rounded-lg hover:bg-green-800 transition-colors text-left">
              <div class="font-semibold">Query Collections</div>
              <div class="text-sm opacity-90 mt-1">
                Traditional polling with TanStack Query
              </div>
            </button>
          </Link>
          <Link to="/electric" class="block w-full">
            <button class="w-full px-6 py-4 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-left">
              <div class="font-semibold">Electric Collections</div>
              <div class="text-sm opacity-90 mt-1">
                Real-time sync with ElectricSQL
              </div>
            </button>
          </Link>
          <Link to="/trailbase" class="block w-full">
            <button class="w-full px-6 py-4 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-left">
              <div class="font-semibold">TrailBase Collections</div>
              <div class="text-sm opacity-90 mt-1">
                Real-time sync with TrailBase
              </div>
            </button>
          </Link>
        </div>

        <div class="mt-8 text-xs text-center text-gray-500">
          All examples use the same API and UI components, showcasing the
          unified interface of TanStack Solid DB.
        </div>
      </div>
    </div>
  )
}
