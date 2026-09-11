import {createHash} from 'node:crypto'
import { parse } from '@babel/parser'
import MagicString, { Bundle } from 'magic-string'
import { resolve } from 'node:path'
import { realpathSync, readFileSync } from 'node:fs'
import { transformBoundEndpoints } from './bound-transform.mjs'

const cleanId = (id) => id.split('?')[0]
function canonical(id) {
  try { return realpathSync(cleanId(id)) } catch { return cleanId(id) }
}
function unsupported(message, node) {
  throw new Error(`ENDPOINT_UNSUPPORTED_GRAMMAR ${message} at ${node.loc.start.line}:${node.loc.start.column + 1}`)
}

// Explicit module policy, not inferred server secrecy. Reject client loads
// before source is read: transform-hook errors can echo source into dev responses.
export function serverBoundary({ serverModules = [] } = {}) {
  let serverFiles = new Set()
  return {
    name: 'endpoints-server-boundary',
    enforce: 'pre',
    configureServer(server) {
      // Vite dev embeds maps after transform hooks; filter the delivered map,
      // not an intermediate map that later composition can refill.
      server.middlewares.use((_request, response, next) => {
        const end = response.end
        response.end = function(chunk, ...args) {
          if (typeof chunk === 'string' || Buffer.isBuffer(chunk)) {
            const source = chunk.toString()
            const sanitized = source.replace(/(sourceMappingURL=data:application\/json[^,]*;base64,)([^\s]+)/g, (_match, prefix, encoded) => {
              try {
                const map = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
                delete map.sourcesContent
                return prefix + Buffer.from(JSON.stringify(map)).toString('base64')
              } catch {
                // Drop a malformed map comment rather than crash a response.
                return ''
              }
            })
            if (sanitized !== source) {
              chunk = sanitized
              if (!this.headersSent) this.removeHeader('Content-Length')
            }
          }
          return end.call(this, chunk, ...args)
        }
        next()
      })
    },
    configEnvironment(name) {
      // Client maps retain positions but must not publish authored server bodies.
      if (name === 'client') return { build: { rollupOptions: { output: { sourcemapExcludeSources: true } } } }
    },
    configResolved(config) {
      serverFiles = new Set(serverModules.map(file => canonical(resolve(config.root, file))))
    },
    load(id) {
      if (this.environment?.name !== 'client') return
      if (cleanId(id).endsWith('/endpoint.tsx') && /[?&](raw|url)(?:[=&]|$)/.test(id)) this.error('ENDPOINT_UNSUPPORTED_GRAMMAR endpoint raw/url imports expose authored server code')
      const file = canonical(id)
      // Validate authored endpoint syntax while still in the load hook. Vite
      // transform errors otherwise include its entire active source in dev.
      if (file.endsWith('/endpoint.tsx')) endpointsProbe().transform(readFileSync(file, 'utf8'), id)
      if (serverFiles.has(file) || /\.server\.[cm]?[jt]sx?$/.test(file)) {
        this.error(`ENDPOINT_SERVER_IMPORT_IN_CLIENT ${file}: a server-only module remains reachable in the client after endpoint extraction`)
      }
    },
  }
}

export function endpointsProbe() {
  return {
    name: 'endpoints-probe',
    enforce: 'pre',
    transform(code, id) {
      if (!cleanId(id).endsWith('/endpoint.tsx')) return
      if (/[?&](raw|url)(?:[=&]|$)/.test(id)) throw new Error('ENDPOINT_UNSUPPORTED_GRAMMAR endpoint raw/url imports expose authored server code')
      const ast = parse(code, { sourceType: 'module', plugins: ['typescript','jsx'] })
      const bound = transformBoundEndpoints(code, cleanId(id), ast)
      if (bound) return bound
      const runtimeImport = ast.program.body.find(node => node.type === 'ImportDeclaration' && node.source.value === './runtime')
      const mutationImport = runtimeImport?.specifiers.find(node => node.type === 'ImportSpecifier' && node.imported.name === 'mutation')
      const queryImport = runtimeImport?.specifiers.find(node => node.type === 'ImportSpecifier' && node.imported.name === 'query')
      if (queryImport && queryImport.local.name !== 'query') unsupported('aliased query imports', queryImport)
      if (!mutationImport && !queryImport) {
        if (/\b(?:mutation|query)\s*\(/.test(code)) unsupported('mutation must be imported from ./runtime', ast.program)
        return
      }
      if (mutationImport && mutationImport.local.name !== 'mutation') unsupported('aliased mutation imports', mutationImport)
      const declarations = []
      const recognizedCalls = new Set()
      for (const statement of ast.program.body) {
        const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement
        if (declaration?.type !== 'VariableDeclaration') continue
        for (const item of declaration.declarations) {
          if (item.init?.type !== 'CallExpression' || item.init.callee.type !== 'Identifier' || !['mutation','query'].includes(item.init.callee.name)) continue
          if (declaration.kind !== 'const' || declaration.declarations.length !== 1 || item.id.type !== 'Identifier') unsupported('use one const declaration per statement', declaration)
          if (item.init.arguments.length !== 1 || item.init.arguments[0].type !== 'ObjectExpression') unsupported('mutation needs one object literal', item.init)
          const kind = item.init.callee.name
          if(kind === 'mutation' && !mutationImport) unsupported('mutation must be imported from ./runtime',item)
          if(kind === 'query' && !queryImport) unsupported('query must be imported from ./runtime',item)
          if(!ast.program.body.some(n=>n.type==='ImportDeclaration'&&n.source.value==='zod'&&n.specifiers.some(s=>s.type==='ImportSpecifier'&&s.imported.name==='z'&&s.local.name==='z')))unsupported('z must be imported from zod',item)
          const count = kind === 'query' ? 2 : 3
          const props = item.init.arguments[0].properties
          if (props.length !== count || props.some(prop => !['ObjectMethod','ObjectProperty'].includes(prop.type) || prop.computed || prop.key.type !== 'Identifier')) unsupported('use only input, handler and onMutate properties', item.init)
          const values = Object.fromEntries(props.map(prop => [prop.key.name, prop]))
          if (Object.keys(values).length !== count || !values.input || !values.handler || (kind === 'mutation' && !values.onMutate) || (kind === 'query' && values.onMutate)) unsupported('input, handler and onMutate are required exactly once', item.init)
          if (values.input.type !== 'ObjectProperty' || values.handler.type !== 'ObjectMethod' || (values.onMutate && values.onMutate.type !== 'ObjectMethod') || values.handler.generator || values.onMutate?.generator || values.handler.kind !== 'method' || (values.onMutate && values.onMutate.kind !== 'method')) unsupported('input value and inline handler/onMutate methods required', item.init)
          if (code.includes(`${item.id.name}Rpc`)) unsupported('generated RPC binding collision', item)
          recognizedCalls.add(item.init)
          declarations.push({ statement, item, values, kind })
        }
      }
      // Refuse nested calls and shadowed/unsupported calls instead of leaving an
      // untransformed runtime declaration that might execute on the browser.
      function visit(node, parent) {
        if (!node || typeof node !== 'object') return
        if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && ['mutation','query'].includes(node.callee.name) && !recognizedCalls.has(node)) unsupported('nested or unsupported mutation call', node)
        if (node.type === 'Identifier' && ['mutation','query'].includes(node.name) && parent?.type !== 'ImportSpecifier' && !(parent?.type === 'CallExpression' && parent.callee === node && recognizedCalls.has(parent))) unsupported('mutation binding may only be called directly at top level', node)
        if (node.type === 'ThisExpression' || node.type === 'Super') unsupported('method receiver semantics', node)
        for (const value of Object.values(node)) {
          if (Array.isArray(value)) value.forEach(child => visit(child, node))
          else if (value && typeof value === 'object') visit(value, node)
        }
      }
      visit(ast.program)
      if (!declarations.length) return
      if (ast.program.body.some(node => node.type === 'ImportDeclaration' && node.specifiers.some(specifier => specifier.local.name === '__endpointCreateServerFn'))) unsupported('reserved import binding', ast.program)
      const original = new MagicString(code, { filename: cleanId(id) })
      const bundle = new Bundle({ separator: '' })
      const append = text => bundle.append(text)
      const source = (start, end) => bundle.addSource({ content: original.snip(start, end) })
      const method = node => { append(node.async ? 'async function' : 'function'); source(node.key.end, node.end) }
      append("import {createServerFn as __endpointCreateServerFn} from '@tanstack/react-start';\nimport {makeQuery as __makeQuery,makeMutation as __makeMutation} from './runtime';\n")
      let cursor = 0
      for (const { statement, item, values, kind } of declarations) {
        source(cursor, statement.start)
        append(`const ${item.id.name}Rpc=__endpointCreateServerFn({method:'POST'}).inputValidator(z.object({scope:z.enum(['alice','bob']),input:`)
        source(values.input.value.start, values.input.value.end)
        append('})).handler(async ({data})=>(')
        method(values.handler)
        append(`)({body:data.input,scope:data.scope,kind:'${kind}',endpointSourceHash:'${createHash('sha256').update(code).digest('hex')}'},{json:value=>value}));\n`)
        append(statement.type === 'ExportNamedDeclaration' ? 'export const ' : 'const ')
        source(item.id.start, item.id.end)
        if (kind === 'query') {
          append(`=__makeQuery('${item.id.name}',${item.id.name}Rpc);`)
        } else {
          append(`=__makeMutation('${item.id.name}',${item.id.name}Rpc,`)
          method(values.onMutate)
          append(');')
        }
        cursor = statement.end
      }
      source(cursor, code.length)
      return { code: bundle.toString(), map: bundle.generateMap({ hires: true, includeContent: true }) }
    },
  }
}
