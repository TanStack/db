export function schemaFootprint(snapshot, tables, operation) {
  const key = (table) => JSON.stringify([table.schema, table.name])
  const catalog = new Map(snapshot.tables.map((table) => [key(table), table]))
  const pending = tables.map((table) => {
    if (table.schema) return { ...table, operation }
    const schema = snapshot.searchPath.find((schema) =>
      catalog.has(key({ ...table, schema })),
    )
    return { ...table, schema, operation }
  })
  const visited = new Set(),
    dependencies = new Set()
  while (pending.length) {
    const table = pending.pop(),
      id = key(table),
      step = JSON.stringify([id, table.operation])
    if (visited.has(step)) continue
    visited.add(step)
    const actual = catalog.get(id)
    if (!actual?.readable || (table.operation !== 'select' && !actual.writable))
      return null
    dependencies.add(id)
    if (table.operation === 'select' || table.operation === 'insert') continue
    for (const child of actual.children) {
      const action = child[table.operation]
      if (['a', 'r'].includes(action)) continue
      if (!['c', 'n', 'd'].includes(action)) return null
      pending.push({
        ...child,
        operation:
          table.operation === 'delete' && action === 'c' ? 'delete' : 'update',
      })
    }
  }
  return [...dependencies].sort()
}
