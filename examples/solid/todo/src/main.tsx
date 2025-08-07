import { RouterProvider } from "@tanstack/solid-router"
import { createRouter } from "./router"
import "./index.css"
import { render } from "solid-js/web"

const router = createRouter()

render(
  () => <RouterProvider router={router} />,
  document.getElementById(`root`)!
)
