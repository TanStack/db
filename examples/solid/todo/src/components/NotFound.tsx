import { Link } from "@tanstack/solid-router"

export function NotFound() {
  return (
    <div class="min-h-screen flex items-center justify-center bg-gray-50">
      <div class="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
        <div class="text-6xl font-bold text-gray-300 mb-4">404</div>
        <h1 class="text-2xl font-bold text-gray-800 mb-4">Page Not Found</h1>
        <p class="text-gray-600 mb-8">
          The page you're looking for doesn't exist or has been moved.
        </p>

        <div class="space-y-4">
          <Link to="/" class="block w-full">
            <button class="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
              Go Home
            </button>
          </Link>

          <div class="flex space-x-4">
            <Link to="/query" class="flex-1">
              <button class="w-full px-4 py-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors text-sm">
                Query Demo
              </button>
            </Link>
            <Link to="/electric" class="flex-1">
              <button class="w-full px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors text-sm">
                Electric Demo
              </button>
            </Link>
            <Link to="/trailbase" class="flex-1">
              <button class="w-full px-4 py-2 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 transition-colors text-sm">
                TrailBase Demo
              </button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
