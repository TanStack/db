import { parse } from '@babel/parser'
import traverseModule from '@babel/traverse'
import { renderSchemaProgram } from './schema-program.mjs'
const traverse = traverseModule.default ?? traverseModule
export function registryProgram(base) {
  const program = {
    ...base,
    nested: base.scope === 'bob',
    queries: [
      ...base.tables.map((_, table) => ({ table, predicate: null })),
      ...base.tables.flatMap((_, table) =>
        [false, true].map((value) => ({
          table,
          predicate: { op: 'eq', column: 'completed', value },
        })),
      ),
    ],
  }
  program.orders = program.queries.map(() => ['createdAt', 'id'])
  return program
}
export function renderRegistryProgram(program) {
  const original = renderSchemaProgram(program)
  const replacements = [],
    helpers = []
  const ast = parse(original, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
  })
  traverse(ast, {
    VariableDeclarator(path) {
      const match = /^rows([0-9]+)$/.exec(path.node.id.name ?? '')
      if (!match || Number(match[1]) < program.tables.length) return
      const index = Number(match[1]),
        query = program.queries[index],
        table = program.tables[query.table].name
      replacements.push({
        start: path.node.init.start,
        end: path.node.init.end,
        text: `peer${query.table}(dbClient,${query.predicate.value})`,
      })
      if (query.predicate.value) return
      const config = path.node.init.arguments[0]
      const source = original
        .slice(config.start, config.end)
        .replace(
          'input:z.object({})',
          'input:z.object({completed:z.boolean()}),params:{completed}',
        )
        .replace(
          `eq(${table}.completed,false)`,
          `eq(${table}.completed,req.body.completed)`,
        )
      helpers.push(
        `export function peer${query.table}(dbClient,completed){const {query,mutation}=endpoints(dbClient);const rows=query(${source});return rows}`,
      )
    },
  })
  let main = original
  for (const change of replacements.sort((a, b) => b.start - a.start))
    main = main.slice(0, change.start) + change.text + main.slice(change.end)
  main =
    `import {${program.tables.map((_, i) => 'peer' + i).join(',')}} from './${program.nested ? 'nested/peers' : 'peers'}.endpoint'\n` +
    main
  const peer =
    `import {z} from 'zod'\nimport {endpoints} from './runtime'\nimport {db,${program.tables.map((t) => t.name).join(',')},requireUser} from './database.server'\nimport {asc,eq,and} from 'drizzle-orm'\n` +
    helpers.join('\n')

  return {
    main,
    peer: program.nested
      ? peer
          .replaceAll("from './runtime'", "from '../runtime'")
          .replaceAll("from './database.server'", "from '../database.server'")
      : peer,
  }
}

export const registryFiles = (program) => ({
  [program.nested ? 'nested/peers.endpoint.ts' : 'peers.endpoint.tsx']:
    renderRegistryProgram(program).peer,
})
