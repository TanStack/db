import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "@tanstack/react-router"
import { getRouter } from "./router"
import "./index.css"

const router = getRouter()

createRoot(document.getElementById(`root`)!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
)
