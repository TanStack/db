import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import type {PersistedTodosHandle} from '~/db/persisted-todos';
import { PersistedTodoDemo } from '~/components/PersistedTodoDemo'
import {
  
  createPersistedTodoCollection
} from '~/db/persisted-todos'

export const Route = createFileRoute(`/wa-sqlite`)({
  component: WASQLiteDemo,
})

function WASQLiteDemo() {
  const [handle, setHandle] = useState<PersistedTodosHandle | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false
    let currentHandle: PersistedTodosHandle | null = null

    createPersistedTodoCollection()
      .then((h) => {
        if (disposed) {
          h.close()
          return
        }
        currentHandle = h
        setHandle(h)
      })
      .catch((err) => {
        if (!disposed) {
          console.error(`Failed to initialize wa-sqlite persistence:`, err)
          setError(
            err instanceof Error ? err.message : `Failed to initialize persistence`,
          )
        }
      })

    return () => {
      disposed = true
      currentHandle?.close()
    }
  }, [])

  if (error) {
    return (
      <div className="min-h-screen bg-gray-100 py-8">
        <div className="max-w-2xl mx-auto p-6">
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-2xl">⚠️</span>
              <div>
                <h2 className="text-2xl font-bold text-gray-900">
                  Persistence Unavailable
                </h2>
                <p className="text-gray-600">
                  wa-sqlite OPFS persistence could not be initialized.
                </p>
              </div>
            </div>
            <div className="p-3 bg-red-100 border border-red-300 rounded-md">
              <p className="text-red-700 text-sm">{error}</p>
            </div>
            <p className="mt-4 text-sm text-gray-500">
              This feature requires a browser with OPFS support (Chrome 102+,
              Edge 102+, Firefox 111+, Safari 15.2+) and a secure context
              (HTTPS or localhost).
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (!handle) {
    return (
      <div className="min-h-screen bg-gray-100 py-8">
        <div className="max-w-2xl mx-auto p-6">
          <div className="bg-white rounded-lg shadow-lg p-6 text-center">
            <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-2" />
            <p className="text-gray-600">Initializing wa-sqlite persistence...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 py-8">
      <PersistedTodoDemo collection={handle.collection} />
    </div>
  )
}
