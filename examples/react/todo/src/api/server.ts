import express from "express"
import cors from "cors"
import mutationsRouter from "./mutations"

// Create Express app
const app = express()
const PORT = process.env.PORT || 3001

// Middleware
app.use(cors())
app.use(express.json())

// Routes
app.use(mutationsRouter)

// Health check endpoint
app.get(`/api/health`, (req, res) => {
  res.status(200).json({ status: `ok` })
})

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})

export default app
