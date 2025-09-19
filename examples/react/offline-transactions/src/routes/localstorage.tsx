import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { TodoDemo } from "~/components/TodoDemo"
import { createLocalStorageOfflineExecutor } from "~/db/todos"

export const Route = createFileRoute(`/localstorage`)({
  component: LocalStorageDemo,
})

function LocalStorageDemo() {
  const [offline, setOffline] = useState<any>(null)

  useEffect(() => {
    const offlineExecutor = createLocalStorageOfflineExecutor()
    setOffline(offlineExecutor)

    return () => {
      offlineExecutor.dispose()
    }
  }, [])

  return (
    <div className="min-h-screen bg-gray-100 py-8">
      <TodoDemo
        title="localStorage Storage Demo"
        description="Fallback offline storage with localStorage. Limited storage but works everywhere."
        storageType="localstorage"
        offline={offline}
      />
    </div>
  )
}
