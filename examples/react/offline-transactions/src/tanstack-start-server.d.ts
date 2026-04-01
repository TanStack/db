// Type declarations for @tanstack/react-start/server
// The @tanstack/react-start-server package types aren't resolvable due to
// pnpm hoisting — the Vite plugin handles these at build time.
declare module '@tanstack/react-start/server' {
  export function createServerFileRoute(
    path: string,
  ): {
    methods: (methods: Record<string, (...args: Array<any>) => any>) => {
      middleware: (
        middleware: Array<any>,
      ) => { methods: (methods: Record<string, (...args: Array<any>) => any>) => any }
    }
  }

  export function getRequestHeaders(): Record<string, string>
}
