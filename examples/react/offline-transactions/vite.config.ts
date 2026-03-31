import fs from 'node:fs'
import path from 'node:path'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { defineConfig } from 'vite'
import tsConfigPaths from 'vite-tsconfig-paths'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import chokidar from 'chokidar'

function watchWorkspacePackages() {
  return {
    name: `watch-workspace-packages`,
    configureServer(server: any) {
      const watchPaths = [
        path.resolve(__dirname, `../../../packages/db/dist`),
        path.resolve(__dirname, `../../../packages/offline-transactions/dist`),
        path.resolve(
          __dirname,
          `../../../packages/browser-db-sqlite-persistence/src`,
        ),
        path.resolve(
          __dirname,
          `../../../packages/db-sqlite-persistence-core/dist`,
        ),
      ]

      console.log(`[watch-workspace] Starting to watch paths:`)
      watchPaths.forEach((p) => console.log(`  - ${p}`))
      console.log(`[watch-workspace] Current directory: ${__dirname}`)
      console.log(`[watch-workspace] Resolved paths:`)
      watchPaths.forEach((p) => console.log(`  - ${path.resolve(p)}`))

      let ready = false

      const watcher = chokidar.watch(watchPaths, {
        ignored: /node_modules/,
        persistent: true,
      })

      watcher.on(`ready`, () => {
        ready = true
        console.log(
          `[watch-workspace] Initial scan complete. Watching for changes...`,
        )
      })

      watcher.on(`add`, (filePath) => {
        if (!ready) return
        console.log(`[watch-workspace] File added: ${filePath}`)
        server.ws.send({
          type: `full-reload`,
        })
      })

      watcher.on(`change`, (filePath) => {
        if (!ready) return
        console.log(`[watch-workspace] File changed: ${filePath}`)
        server.ws.send({
          type: `full-reload`,
        })
      })

      watcher.on(`error`, (error) => {
        console.error(`[watch-workspace] Watcher error:`, error)
      })
    },
  }
}

export default defineConfig({
  server: {
    port: 3000,
    watch: {
      ignored: [`!**/node_modules/@tanstack/**`],
    },
  },
  // resolve aliases commented out to test against built dist/ output
  // resolve: {
  //   alias: {
  //     // Resolve to source so Vite can process the ?worker import natively
  //     '@tanstack/browser-db-sqlite-persistence': path.resolve(
  //       __dirname,
  //       `../../../packages/browser-db-sqlite-persistence/src/index.ts`,
  //     ),
  //     // Required because the browser package's source re-exports from core
  //     '@tanstack/db-sqlite-persistence-core': path.resolve(
  //       __dirname,
  //       `../../../packages/db-sqlite-persistence-core/src/index.ts`,
  //     ),
  //   },
  // },
  optimizeDeps: {
    exclude: [
      `@tanstack/db`,
      `@tanstack/offline-transactions`,
      `@tanstack/browser-db-sqlite-persistence`,
      `@tanstack/db-sqlite-persistence-core`,
      `@journeyapps/wa-sqlite`,
    ],
  },
  plugins: [
    // Serve .wasm files before TanStack Start's catch-all handler intercepts them.
    // We use configureServer returning a function (post-hook) and unshift onto the
    // stack so this runs before any other middleware including TanStack Start.
    {
      name: `serve-wasm-files`,
      configureServer(server: any) {
        const wasmHandler = (req: any, res: any, next: () => void) => {
          // Strip query string before checking extension
          const urlWithoutQuery = (req.url ?? ``).split(`?`)[0]
          if (!urlWithoutQuery.endsWith(`.wasm`)) {
            return next()
          }

          // Handle /@fs/ paths used by Vite for serving node_modules files
          const fsPrefix = `/@fs`
          let filePath: string | undefined
          if (urlWithoutQuery.startsWith(fsPrefix)) {
            filePath = urlWithoutQuery.slice(fsPrefix.length)
          }

          if (!filePath || !fs.existsSync(filePath)) {
            return next()
          }

          const content = fs.readFileSync(filePath)
          res.writeHead(200, {
            'Content-Type': `application/wasm`,
            'Content-Length': content.byteLength,
            'Cache-Control': `no-cache`,
          })
          res.end(content)
        }

        // Prepend to the middleware stack so it runs before TanStack Start
        server.middlewares.stack.unshift({
          route: ``,
          handle: wasmHandler,
        })
      },
    },
    watchWorkspacePackages(),
    tsConfigPaths({
      projects: [`./tsconfig.json`],
    }),
    tanstackStart({
      customViteReactPlugin: true,
      mode: `spa`, // SPA mode for client-side only offline features
    }),
    viteReact(),
    tailwindcss(),
  ],
})
