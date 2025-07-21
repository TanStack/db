import WebSocket from "ws"

console.log("Testing WebSocket connection to Materialize proxy...")

const ws = new WebSocket("ws://localhost:5173/api/todos-ws")

ws.on("open", function open() {
  console.log("✅ Connected to WebSocket proxy")
})

ws.on("message", function message(data) {
  console.log("📨 Received:", JSON.parse(data.toString()))
})

ws.on("error", function error(err) {
  console.error("❌ WebSocket error:", err.message)
})

ws.on("close", function close() {
  console.log("🔌 Connection closed")
})

// Close after 10 seconds to give more time for data
setTimeout(() => {
  console.log("⏰ Timeout reached, closing connection")
  ws.close()
}, 10000)

/**
Client disconnected from Materialize proxy
Client connected to Materialize proxy via Vite plugin
Backend websocket error: Error: socket hang up
    at Socket.socketOnEnd (node:_http_client:528:25)
    at Socket.emit (node:events:530:35)
    at endReadableNT (node:internal/streams/readable:1698:12)
    at process.processTicksAndRejections (node:internal/process/task_queues:82:21) {
  code: 'ECONNRESET'
}
Backend websocket closed: 1006 
*/
