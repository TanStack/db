import { Link, createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute(`/`)({
  component: Home,
})

function Home() {
  return (
    <div className="min-h-screen bg-gray-100">
      <div className="max-w-4xl mx-auto py-12 px-6">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            TanStack Offline Transactions Demo
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Experience offline-first development with automatic data
            persistence, multi-tab coordination, and seamless sync when
            connectivity returns.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8 mb-12">
          <Link to="/indexeddb">
            <div className="bg-white rounded-lg shadow-lg p-6 hover:shadow-xl transition-shadow cursor-pointer group">
              <div className="flex items-center mb-4">
                <span className="text-3xl mr-3">🗄️</span>
                <h2 className="text-2xl font-bold text-gray-900 group-hover:text-blue-600">
                  IndexedDB Storage
                </h2>
              </div>
              <p className="text-gray-600 mb-4">
                Persistent offline storage with IndexedDB. Best performance and
                reliability for offline-first applications.
              </p>
              <div className="flex flex-wrap gap-2">
                <span className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded">
                  High Storage Limit
                </span>
                <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded">
                  Structured Data
                </span>
                <span className="px-2 py-1 bg-purple-100 text-purple-800 text-xs rounded">
                  Async API
                </span>
              </div>
            </div>
          </Link>

          <Link to="/localstorage">
            <div className="bg-white rounded-lg shadow-lg p-6 hover:shadow-xl transition-shadow cursor-pointer group">
              <div className="flex items-center mb-4">
                <span className="text-3xl mr-3">💾</span>
                <h2 className="text-2xl font-bold text-gray-900 group-hover:text-blue-600">
                  localStorage Fallback
                </h2>
              </div>
              <p className="text-gray-600 mb-4">
                Reliable fallback storage using localStorage. Works everywhere
                but with storage limitations.
              </p>
              <div className="flex flex-wrap gap-2">
                <span className="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs rounded">
                  Universal Support
                </span>
                <span className="px-2 py-1 bg-orange-100 text-orange-800 text-xs rounded">
                  Sync API
                </span>
                <span className="px-2 py-1 bg-red-100 text-red-800 text-xs rounded">
                  Limited Storage
                </span>
              </div>
            </div>
          </Link>
        </div>

        <div className="bg-white rounded-lg shadow-lg p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">
            Features Demonstrated
          </h2>
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-800 mb-3">
                📦 Outbox Pattern
              </h3>
              <p className="text-gray-600 text-sm">
                Mutations are persisted before being applied, ensuring zero data
                loss during offline periods.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-gray-800 mb-3">
                🔄 Automatic Retry
              </h3>
              <p className="text-gray-600 text-sm">
                Failed operations are retried with exponential backoff when
                connectivity is restored.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-gray-800 mb-3">
                👥 Multi-tab Coordination
              </h3>
              <p className="text-gray-600 text-sm">
                Leader election ensures only one tab manages offline storage,
                preventing conflicts.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-gray-800 mb-3">
                ⚡ Optimistic Updates
              </h3>
              <p className="text-gray-600 text-sm">
                UI updates immediately while mutations sync in the background,
                providing snappy user experience.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-8 text-center">
          <p className="text-gray-500 text-sm">
            Like Nephi's compass that worked by faith and diligence, these demos
            work best when you actively test offline scenarios.
          </p>
        </div>
      </div>
    </div>
  )
}
