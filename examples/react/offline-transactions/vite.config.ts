import path from 'node:path'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { defineConfig } from 'vite'
import tsConfigPaths from 'vite-tsconfig-paths'
import viteReact from '@vitejs/plugin-react'
import chokidar from 'chokidar'

function watchWorkspacePackages() {
  return {
    name: `watch-workspace-packages`,
    configureServer(server: any) {
      const watchPaths = [
        path.resolve(__dirname, `../../../packages/db/dist`),
        path.resolve(__dirname, `../../../packages/offline-transactions/dist`),
      ]

      console.log(`[watch-workspace] Starting to watch paths:`)
      watchPaths.forEach((p) => console.log(`  - ${p}`))
      console.log(`[watch-workspace] Current directory: ${__dirname}`)
      console.log(`[watch-workspace] Resolved paths:`)
      watchPaths.forEach((p) => console.log(`  - ${path.resolve(p)}`))

      const watcher = chokidar.watch(watchPaths, {
        ignored: /node_modules/,
        persistent: true,
      })

      watcher.on(`ready`, () => {
        console.log(
          `[watch-workspace] Initial scan complete. Watching for changes...`,
        )
        const watchedPaths = watcher.getWatched()
        console.log(`[watch-workspace] Currently watching:`, watchedPaths)
      })

      watcher.on(`add`, (filePath) => {
        console.log(`[watch-workspace] File added: ${filePath}`)
        server.ws.send({
          type: `full-reload`,
        })
      })

      watcher.on(`change`, (filePath) => {
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
  optimizeDeps: {
    exclude: [`@tanstack/db`, `@tanstack/offline-transactions`],
  },
  plugins: [
    watchWorkspacePackages(),
    tsConfigPaths({
      projects: [`./tsconfig.json`],
    }),
    tanstackStart({
      customViteReactPlugin: true,
      mode: `spa`, // SPA mode for client-side only offline features
    }),
    viteReact(),
  ],
})
