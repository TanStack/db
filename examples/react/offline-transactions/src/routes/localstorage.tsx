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
    let offlineExecutor: any

    // To enable OpenTelemetry tracing, pass otel config:
    // Jaeger:
    // createLocalStorageOfflineExecutor({
    //   endpoint: 'http://localhost:4318/v1/traces',
    // }).then(setOffline)
    // Honeycomb:
    // createLocalStorageOfflineExecutor({
    //   endpoint: 'https://api.honeycomb.io/v1/traces',
    //   headers: { 'x-honeycomb-team': 'YOUR_API_KEY' },
    // }).then(setOffline)

    createLocalStorageOfflineExecutor().then((executor) => {
      offlineExecutor = executor
      setOffline(executor)
    })

    return () => {
      offlineExecutor?.dispose()
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
