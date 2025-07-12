// Export types only for now - Vue SFC files need different build setup
export type { VueDbDevtoolsProps } from "./VueDbDevtools.vue"

// Re-export devtools functions
export { initializeDbDevtools } from "@tanstack/db-devtools"
