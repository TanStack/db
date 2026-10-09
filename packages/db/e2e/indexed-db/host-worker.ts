import { createHost } from './host-driver'
import type { HostCommand, HostSetup } from './host-driver'

let host: Awaited<ReturnType<typeof createHost>>
self.onmessage = async (
  event: MessageEvent<{
    id: number
    command: HostCommand | { type: 'setup'; options: HostSetup }
  }>,
) => {
  const { id, command } = event.data
  try {
    const value =
      command.type === 'setup'
        ? ((host = await createHost(command.options)), undefined)
        : await host(command)
    self.postMessage({ id, value })
  } catch (error) {
    self.postMessage({ id, error: String(error) })
  }
}
