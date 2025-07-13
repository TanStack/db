import React from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "@tanstack/react-router"
import { createRouter } from "./router"
import "./index.css"

const router = createRouter()

createRoot(document.getElementById(`root`)!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
)
