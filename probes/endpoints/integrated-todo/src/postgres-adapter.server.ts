// This structural constraint preserves the supplied driver's complete type,
// including custom parameter types and generic unsafe() result types, without
// requiring Postgres.js in applications using another database adapter.
type PostgresClient = { unsafe: (...args: never[]) => unknown }

/**
 * Postgres.js adapter for Endpoints. It shares the app's existing pool and
 * defaults unsafe() calls to prepared extended-protocol execution.
 * Explicit per-query options and the driver's global prepare:false
 * setting still take precedence. Use this client for the application's normal
 * Drizzle database; no separate read client or preparation flag is needed.
 *
 * Transaction/reserved-client APIs delegate unchanged; their scoped clients
 * retain the driver's normal behavior.
 */
export function postgresAdapter<T extends PostgresClient>(client: T): T {
  function unsafe(...args: unknown[]): unknown {
    let [query, parameters = [], options = {}] = args
    // Postgres.js also accepts unsafe(query, options) without parameters.
    if (args.length === 2 && !Array.isArray(parameters)) {
      options = parameters
      parameters = []
    }
    const suppliedOptions =
      typeof options === 'object' && options !== null ? options : {}
    return Reflect.apply(client.unsafe, client, [
      query,
      parameters,
      { prepare: true, simple: false, ...suppliedOptions },
    ])
  }
  return new Proxy(client, {
    get(target, property, receiver) {
      return property === 'unsafe'
        ? unsafe
        : Reflect.get(target, property, receiver)
    },
  })
}
