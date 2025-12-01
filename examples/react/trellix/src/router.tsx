import { createRouter as createTanstackRouter } from "@tanstack/react-router"

import { routeTree } from "./routeTree.gen"

import "./styles.css"

export function getRouter() {
  return createTanstackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  })
}
