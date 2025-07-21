import WebSocket from "ws"

console.log("Testing direct connection to Materialize...")

const ws = new WebSocket("ws://localhost:6878/api/experimental/sql")

ws.on("open", function open() {
  console.log("✅ Connected to Materialize directly")

  // First authenticate with default credentials for local development
  console.log("Sending auth with default materialize user")
  ws.send(
    JSON.stringify({
      user: "materialize",
      password: "",
    })
  )

  // Then send subscribe query using the proper format from docs
  setTimeout(() => {
    const query = {
      queries: [
        {
          query: "SUBSCRIBE (SELECT * FROM todo_view) WITH (PROGRESS)",
        },
      ],
    }
    console.log("Sending query:", query)
    ws.send(JSON.stringify(query))
  }, 1000)
})

ws.on("message", function message(data) {
  try {
    const msg = JSON.parse(data.toString())
    console.log("📨 Received from Materialize:", msg.type, msg)
  } catch (err) {
    console.log("📨 Raw message:", data.toString())
  }
})

ws.on("error", function error(err) {
  console.error("❌ WebSocket error:", err.message)
})

ws.on("close", function close(code, reason) {
  console.log("🔌 Connection closed:", code, reason.toString())
})

// Close after 10 seconds
setTimeout(() => {
  console.log("⏰ Timeout reached, closing connection")
  ws.close()
}, 10000)
