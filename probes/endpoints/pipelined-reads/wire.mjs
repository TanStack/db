import net from 'node:net'
import { once } from 'node:events'

// Transparent, local, plaintext test proxy. Retains message tags/counts only,
// never SQL, parameters, authentication payloads or row contents.
function frames(onMessage, startup = false) {
  let pending = Buffer.alloc(0)
  return (chunk) => {
    pending = Buffer.concat([pending, chunk])
    while (pending.length >= (startup ? 4 : 5)) {
      const length = startup
        ? pending.readInt32BE(0)
        : pending.readInt32BE(1) + 1
      if (length < 4) throw Error('Invalid PostgreSQL frame')
      if (pending.length < length) break
      onMessage(startup ? 'startup' : String.fromCharCode(pending[0]))
      startup = false
      pending = pending.subarray(length)
    }
  }
}

export async function startWireProxy({
  oneWayMs = 0,
  targetPort = 55479,
} = {}) {
  const sockets = new Set()
  const timers = new Set()
  let nextId = 0
  let counters
  const reset = () => {
    counters = {
      requestBytes: 0,
      responseBytes: 0,
      executeMessages: 0,
      maxOutstandingPerConnection: 0,
      usedConnections: new Set(),
      frontend: {},
      backend: {},
    }
  }
  reset()
  function later(fn) {
    if (oneWayMs === 0) return fn()
    const timer = setTimeout(() => {
      timers.delete(timer)
      fn()
    }, oneWayMs)
    timers.add(timer)
  }
  const server = net.createServer((client) => {
    const id = nextId++
    const upstream = net.connect({ host: '127.0.0.1', port: targetPort })
    const state = { outstanding: 0 }
    for (const socket of [client, upstream]) {
      socket.setNoDelay(true)
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
      socket.on('error', () => {
        client.destroy()
        upstream.destroy()
      })
    }
    const frontend = frames((tag) => {
      counters.frontend[tag] = (counters.frontend[tag] ?? 0) + 1
      if (tag === 'E') {
        state.outstanding++
        counters.executeMessages++
        counters.usedConnections.add(id)
        counters.maxOutstandingPerConnection = Math.max(
          counters.maxOutstandingPerConnection,
          state.outstanding,
        )
      }
    }, true)
    const backend = frames((tag) => {
      counters.backend[tag] = (counters.backend[tag] ?? 0) + 1
      if (tag === 'Z') state.outstanding = Math.max(0, state.outstanding - 1)
    })
    client.on('data', (chunk) => {
      counters.requestBytes += chunk.length
      frontend(chunk)
      later(() => {
        if (!upstream.destroyed) upstream.write(chunk)
      })
    })
    upstream.on('data', (chunk) => {
      counters.responseBytes += chunk.length
      later(() => {
        backend(chunk)
        if (!client.destroyed) client.write(chunk)
      })
    })
    client.on('end', () => later(() => upstream.end()))
    upstream.on('end', () => later(() => client.end()))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return {
    port: server.address().port,
    reset,
    snapshot: () => ({
      ...counters,
      frontend: { ...counters.frontend },
      backend: { ...counters.backend },
      usedConnections: counters.usedConnections.size,
    }),
    close: async () => {
      for (const timer of timers) clearTimeout(timer)
      for (const socket of sockets) socket.destroy()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}
