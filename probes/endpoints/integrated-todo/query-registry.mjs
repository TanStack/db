import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parse } from '@babel/parser'
import { transformBoundEndpoints } from './bound-transform.mjs'
import { loadSchema } from './compiled-dependencies.mjs'
export const isEndpointModule = (id) =>
  /(?:\/endpoint|\.endpoint)\.tsx?$/.test(id.split('?')[0])
const registryId = 'virtual:endpoints-registry.server.ts'
const resolvedId = '\0' + registryId
const modulePrefix = '\0endpoint-definitions:'
export function queryRegistry(
  context = { root: process.cwd(), dependencies: new Set() },
) {
  let root = process.cwd()
  const modules = new Set()
  async function compile(file) {
    const code = await readFile(file, 'utf8')
    return transformBoundEndpoints(
      code,
      file,
      parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] }),
      { root, snapshot: loadSchema(root) },
    )
  }
  async function discover(dir) {
    const found = []
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = resolve(dir, entry.name)
      if (entry.isDirectory()) found.push(...(await discover(file)))
      else if (entry.isFile() && isEndpointModule(file)) found.push(file)
    }
    return found.sort()
  }
  return {
    configResolved(config) {
      root = config.root
      context.root = root
    },
    configureServer(server) {
      context.watchFile = (file) => server.watcher.add(file)
      server.watcher.add(resolve(root, '.endpoints/schema.json'))
      const changed = (event, file) => {
        if (
          !['add', 'change', 'unlink'].includes(event) ||
          !(
            isEndpointModule(file) ||
            context.dependencies.has(file) ||
            file === resolve(root, '.endpoints/schema.json')
          )
        )
          return
        for (const environment of Object.values(server.environments)) {
          for (const key of [resolvedId, ...modules.keys()]) {
            const module = environment.moduleGraph.getModuleById(key)
            if (module) environment.moduleGraph.invalidateModule(module)
          }
        }
        // Query schemas/models are coupled to the registry generation. A reload is
        // safer than retaining collections built from old source during HMR.
        server.ws.send({ type: 'full-reload' })
      }
      server.watcher.on('all', changed)
      server.httpServer?.once('close', () => server.watcher.off('all', changed))
    },
    resolveId(id) {
      if (id === registryId) return resolvedId
      if (id.startsWith(modulePrefix)) return id
    },
    async load(id) {
      if (id !== resolvedId && !id.startsWith(modulePrefix)) return
      if (this.environment?.name === 'client')
        throw Error('ENDPOINT_SERVER_IMPORT_IN_CLIENT query registry')
      if (id.startsWith(modulePrefix)) {
        const file = id.slice(modulePrefix.length, -'.server.ts'.length)
        this.addWatchFile?.(file)
        const result = await compile(file)
        for (const dependency of result?.watchFiles ?? []) {
          context.dependencies.add(dependency)
          context.watchFile?.(dependency)
        }
        context.watchFile?.(resolve(root, '.endpoints/schema.json'))
        return result?.registryCode
      }
      modules.clear()
      const imports = [],
        entries = [],
        identities = new Set(),
        projections = new Map()
      for (const file of await discover(resolve(root, 'src'))) {
        this.addWatchFile?.(file)
        const result = await compile(file)
        if (!result) continue
        for (const entry of result.definitions) {
          if (identities.has(entry.key))
            throw Error('Duplicate query definition')
          identities.add(entry.key)
          // Same imported relation means the same physical binding in this fixture.
          if (!entry.model.fields) continue
          const relation = entry.model.relation
          const fields = [...entry.model.fields].sort().join(',')
          if (projections.has(relation) && projections.get(relation) !== fields)
            throw Error('Incompatible cross-module row projections')
          projections.set(relation, fields)
        }
        const key = modulePrefix + file + '.server.ts',
          name = 'module' + imports.length
        modules.add(key)
        imports.push(
          `import {definitions as ${name}} from ${JSON.stringify(key)};`,
        )
        entries.push(`...${name}`)
      }
      return (
        imports.join('\n') + `\nexport const registry={${entries.join(',')}};`
      )
    },
  }
}
