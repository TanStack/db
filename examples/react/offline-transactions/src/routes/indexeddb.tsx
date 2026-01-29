import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { TodoDemo } from '~/components/TodoDemo'
import { createIndexedDBOfflineExecutor } from '~/db/todos'

export const Route = createFileRoute(`/indexeddb`)({
  component: IndexedDBDemo,
})

function IndexedDBDemo() {
  const [offline, setOffline] = useState<any>(null)

  useEffect(() => {
    let offlineExecutor: any

    createIndexedDBOfflineExecutor().then((executor) => {
      offlineExecutor = executor
      console.log({ offlineExecutor })
      setOffline(executor)
    })

    return () => {
      offlineExecutor?.dispose()
    }
  }, [])

  return (
    <div className="min-h-screen bg-gray-100 py-8">
      <TodoDemo
        title="IndexedDB Storage Demo"
        description="Persistent offline storage with IndexedDB. Data survives browser restarts and provides the best offline experience."
        storageType="indexeddb"
        offline={offline}
      />
    </div>
  )
}
