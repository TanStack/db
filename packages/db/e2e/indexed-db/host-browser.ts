import { createHost } from './host-driver'
import type { HostCommand, HostSetup } from './host-driver'

async function createWorker(options: HostSetup) {
  const worker = new Worker(new URL('./host-worker.ts', import.meta.url), {
    type: 'module',
  })
  let sequence = 0
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()
  worker.onmessage = (
    event: MessageEvent<{ id: number; value?: unknown; error?: string }>,
  ) => {
    const entry = pending.get(event.data.id)!
    pending.delete(event.data.id)
    if (event.data.error) entry.reject(new Error(event.data.error))
    else entry.resolve(event.data.value)
  }
  worker.onerror = (event) => {
    for (const entry of pending.values()) entry.reject(new Error(event.message))
    pending.clear()
  }
  const call = (command: HostCommand | { type: 'setup'; options: HostSetup }) =>
    new Promise<unknown>((resolve, reject) => {
      const id = sequence++
      pending.set(id, { resolve, reject })
      worker.postMessage({ id, command })
    })
  try {
    await call({ type: 'setup', options })
  } catch (error) {
    worker.terminate()
    throw error
  }
  let stopped = false
  return async (command: HostCommand) => {
    if (stopped) {
      if (command.type === 'cleanup') return undefined
      throw new Error('Worker already terminated')
    }
    try {
      return await call(command)
    } finally {
      if (command.type === 'cleanup') {
        stopped = true
        worker.terminate()
      }
    }
  }
}
window.createHost = createHost
window.createWorker = createWorker
declare global {
  interface Window {
    createHost: typeof createHost
    createWorker: typeof createWorker
    host: Awaited<ReturnType<typeof createHost>>
    workerHost: Awaited<ReturnType<typeof createWorker>>
  }
}
