import { createRouter as createTanstackRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

// Create a new router instance
export function getRouter() {
  return createTanstackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent', // Preload on hover/touch
    defaultPreloadStaleTime: 0,
  })
}
