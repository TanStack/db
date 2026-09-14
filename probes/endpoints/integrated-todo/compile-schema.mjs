import { createRequire } from 'node:module'
import { mkdir, writeFile, rename, rm } from 'node:fs/promises'
import { resolve, dirname, relative } from 'node:path'
import { inspectSchema } from './schema-snapshot.mjs'

// Run in the application's build environment, with the same DATABASE_URL as its
// database module. Do not evaluate application modules or copy connection secrets
// into generated files. Other connection setups currently use the fallback.
const root = process.cwd()
const databaseModule = relative(
  root,
  resolve(process.argv[2] ?? 'src/database.server.ts'),
)
const destination = resolve(root, '.endpoints/schema.json')
await mkdir(dirname(destination), { recursive: true })
// Never keep an old proof after failed schema generation.
await rm(destination, { force: true })
if (!process.env.DATABASE_URL) {
  console.log('Endpoints: no DATABASE_URL; schema dependencies remain unknown')
} else {
  const require = createRequire(resolve(root, 'package.json'))
  const { Client } = require('pg')
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  try {
    await client.connect()
    await client.query('BEGIN READ ONLY')
    const snapshot = await inspectSchema(
      (statement) => client.query(statement),
      databaseModule,
    )
    await client.query('COMMIT')
    const temporary = destination + '.tmp'
    await writeFile(temporary, JSON.stringify(snapshot, null, 2) + '\n')
    await rename(temporary, destination)
    console.log(
      `Endpoints: inspected ${snapshot.tables.length} relations for compilation`,
    )
  } catch {
    // Error objects from drivers can include connection details. Keep build
    // output free of credentials and fail closed to the absent snapshot.
    console.error(
      'Endpoints: schema inspection failed; no dependency proof was generated',
    )
    process.exitCode = 1
  } finally {
    await client.end()
  }
}
