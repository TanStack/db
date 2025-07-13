import React from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "@tanstack/react-router"
import { createRouter } from "./router"
import { initializeDbDevtools } from "@tanstack/react-db-devtools"
import "./index.css"

// Initialize DB devtools BEFORE any collections are created
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  console.log('Main: Initializing devtools early...')
  initializeDbDevtools()
}

const router = createRouter()

createRoot(document.getElementById(`root`)!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
)
