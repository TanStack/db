import WebSocket, { WebSocketServer } from "ws"
import type { Plugin } from "vite"
import type { IncomingMessage } from "node:http"
import type { Duplex } from "node:stream"

export function materializeWebSocketPlugin(): Plugin {
  return {
    name: `materialize-websocket`,
    configureServer(server) {
      if (!server.httpServer) return

      const wss = new WebSocketServer({
        noServer: true,
      })

      // Materialize proxy configuration
      const mzHost = process.env.MZ_HOST ?? `localhost`
      const mzPort = process.env.MZ_PORT ?? `6878`
      const sourceName = process.env.PG_SOURCE ?? `todo_source`
      const progressSubsource = `${sourceName}_progress`

      // Handle WebSocket upgrade requests
      server.httpServer.on(
        `upgrade`,
        (request: IncomingMessage, socket: Duplex, head: Buffer) => {
          if (request.url === `/api/todos-ws`) {
            wss.handleUpgrade(request, socket, head, (ws) => {
              wss.emit(`connection`, ws, request)
            })
          }
        }
      )

      // WebSocket handler for Materialize proxy
      wss.on(`connection`, (client) => {
        console.log(`Client connected to Materialize proxy via Vite plugin`)
        const backend = new WebSocket(
          `ws://${mzHost}:${mzPort}/api/experimental/sql`
        )
        // Separate connection for LSN queries
        const lsnBackend = new WebSocket(
          `ws://${mzHost}:${mzPort}/api/experimental/sql`
        )
        let latestTimestamp = -Infinity
        let lsnBackendReady = false

        backend.on(`open`, () => {
          console.log(`Connected to Materialize backend`)
          // Authenticate with materialize user for local development
          console.log(`Authenticating with materialize user`)
          backend.send(
            JSON.stringify({
              user: `materialize`,
              password: ``,
            })
          )

          // Send SUBSCRIBE query after a short delay to allow authentication
          setTimeout(() => {
            const subscribeQuery = `SUBSCRIBE (SELECT * FROM todo_view) WITH (PROGRESS)`
            console.log(`Sending subscribe query:`, subscribeQuery)
            backend.send(
              JSON.stringify({
                queries: [{ query: subscribeQuery }],
              })
            )
          }, 1000)
        })

        // Set up LSN backend connection
        lsnBackend.on(`open`, () => {
          console.log(`Connected to Materialize LSN backend`)
          // Authenticate LSN backend
          lsnBackend.send(
            JSON.stringify({
              user: `materialize`,
              password: ``,
            })
          )
        })

        lsnBackend.on(`message`, (data) => {
          try {
            const msg = JSON.parse(data.toString())

            // Only handle Row messages for LSN responses
            if (msg.type === `Row`) {
              const payload = msg.payload as Array<any>

              // LSN query responses should have exactly one value
              if (payload.length === 1) {
                client.send(JSON.stringify({ type: `lsn`, value: payload[0] }))
              }
            } else if (msg.type === `ReadyForQuery`) {
              // console.log(`[LSN BACKEND] Ready for queries`)
              lsnBackendReady = true
            }
          } catch (error) {
            console.error(`Error parsing LSN backend message:`, error)
          }
        })

        lsnBackend.on(`error`, (err) => {
          console.error(`LSN backend websocket error:`, err)
        })

        lsnBackend.on(`close`, (code, reason) => {
          console.log(`LSN backend websocket closed:`, code, reason.toString())
        })

        backend.on(`message`, (data) => {
          try {
            const msg = JSON.parse(data.toString())

            // Handle different message types from Materialize WebSocket API
            if (msg.type === `Row`) {
              const payload = msg.payload as Array<any>
              // Payload for SUBSCRIBE always has at least 3 values: mz_timestamp, mz_progressed, mz_diff
              const mz_ts = Number(payload[0])
              const mz_progressed = payload[1]
              const mz_diff = payload[2]

              // When mz_progressed === true, it's a progress marker.
              // If the logical time advanced, query the LSN from the progress subsource.
              if (mz_progressed === true && mz_ts > latestTimestamp) {
                latestTimestamp = mz_ts

                // Send LSN query on separate connection
                if (lsnBackendReady) {
                  lsnBackend.send(
                    JSON.stringify({
                      queries: [
                        { query: `SELECT lsn FROM ${progressSubsource}` },
                      ],
                    })
                  )
                } else {
                  console.log(
                    `[VITE PLUGIN] LSN backend not ready, skipping query`
                  )
                }
                return
              }

              // Otherwise, forward the data row.
              const [_, __, ___, id, text, completed, created_at, updated_at] =
                payload
              client.send(
                JSON.stringify({
                  type: `data`,
                  mz_timestamp: mz_ts,
                  mz_progressed,
                  mz_diff,
                  row: {
                    id: Number(id),
                    text,
                    completed: completed === true,
                    created_at,
                    updated_at,
                  },
                })
              )
            } else if (msg.type === `CommandStarting`) {
              console.log(`Command starting:`, msg)
            } else if (msg.type === `ReadyForQuery`) {
              console.log(`Ready for query:`, msg)
            } else if (msg.type === `Error`) {
              console.error(`Materialize error:`, msg)
            }
          } catch (error) {
            console.error(`Error parsing Materialize message:`, error)
          }
        })

        backend.on(`error`, (err) => {
          console.error(`Backend websocket error:`, err)
          client.close()
        })

        backend.on(`close`, (code, reason) => {
          console.log(`Backend websocket closed:`, code, reason.toString())
        })

        client.on(`close`, () => {
          console.log(`Client disconnected from Materialize proxy`)
          backend.close()
          lsnBackend.close()
        })

        client.on(`error`, (err) => {
          console.error(`Client websocket error:`, err)
          backend.close()
          lsnBackend.close()
        })
      })
    },
  }
}
