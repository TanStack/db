import { createConnection, createServer } from 'node:net'
import type { Socket } from 'node:net'

/**
 * Forward real HTTP and WebSocket bytes without interpreting Convex messages.
 * Closing the gate destroys existing TCP connections and refuses new ones, so
 * SDK recovery must use its public reconnect path against the actual backend.
 */
export async function createNetworkGate(backendUrl: string) {
  const target = new URL(backendUrl)
  if (target.hostname !== `127.0.0.1`)
    throw new Error(`Network tests require an isolated loopback backend`)
  const connections = new Set<Socket>()
  let online = true
  const server = createServer((incoming) => {
    if (!online) {
      incoming.destroy()
      return
    }
    const outgoing = createConnection(Number(target.port), target.hostname)
    connections.add(incoming)
    connections.add(outgoing)
    const close = () => {
      connections.delete(incoming)
      connections.delete(outgoing)
      incoming.destroy()
      outgoing.destroy()
    }
    incoming.on(`error`, close).on(`close`, close)
    outgoing.on(`error`, close).on(`close`, close)
    incoming.pipe(outgoing).pipe(incoming)
  })
  await new Promise<void>((resolve, reject) => {
    server.once(`error`, reject)
    server.listen(0, `127.0.0.1`, resolve)
  })
  const address = server.address()
  if (!address || typeof address === `string`)
    throw new Error(`Expected a TCP listening address`)
  return {
    url: `http://127.0.0.1:${address.port}`,
    disconnect() {
      online = false
      for (const socket of connections) socket.destroy()
    },
    reconnect() {
      online = true
    },
    async close() {
      online = false
      for (const socket of connections) socket.destroy()
      await new Promise<void>((resolve, reject) =>
        server.close((cause) => (cause ? reject(cause) : resolve())),
      )
    },
  }
}
