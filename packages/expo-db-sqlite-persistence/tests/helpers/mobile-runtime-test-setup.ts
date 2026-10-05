import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ExpoSQLiteTestDatabaseFactory } from './expo-sqlite-test-db'

const FACTORY_MODULE_ENV_VAR = `TANSTACK_DB_MOBILE_SQLITE_FACTORY_MODULE`
const FACTORY_EXPORT_ENV_VAR = `TANSTACK_DB_MOBILE_SQLITE_FACTORY_EXPORT`
const REQUIRE_FACTORY_ENV_VAR = `TANSTACK_DB_MOBILE_REQUIRE_RUNTIME_FACTORY`
const DEFAULT_FACTORY_EXPORT_NAME = `createMobileSQLiteTestDatabaseFactory`

type MobileSQLiteFactoryExport =
  | ExpoSQLiteTestDatabaseFactory
  | (() => ExpoSQLiteTestDatabaseFactory)
  | (() => Promise<ExpoSQLiteTestDatabaseFactory>)

function toImportSpecifier(rawSpecifier: string): string {
  if (rawSpecifier.startsWith(`.`) || isAbsolute(rawSpecifier)) {
    const absolutePath = isAbsolute(rawSpecifier)
      ? rawSpecifier
      : resolve(process.cwd(), rawSpecifier)
    return pathToFileURL(absolutePath).href
  }

  return rawSpecifier
}

async function resolveFactoryFromExport(
  exportedFactory: unknown,
): Promise<ExpoSQLiteTestDatabaseFactory | null> {
  if (typeof exportedFactory !== `function`) {
    return null
  }

  const candidate = exportedFactory as MobileSQLiteFactoryExport
  if (candidate.length === 0) {
    const resolvedFactory = await (
      candidate as
        | (() => ExpoSQLiteTestDatabaseFactory)
        | (() => Promise<ExpoSQLiteTestDatabaseFactory>)
    )()
    if (typeof resolvedFactory === `function`) {
      return resolvedFactory
    }
  }

  return candidate as ExpoSQLiteTestDatabaseFactory
}

globalThis.__tanstackDbCreateMobileSQLiteTestDatabase = undefined

const runtimeFactoryModule = process.env[FACTORY_MODULE_ENV_VAR]?.trim()
const requireRuntimeFactory =
  process.env[REQUIRE_FACTORY_ENV_VAR]?.trim() === `1`

if (requireRuntimeFactory && !runtimeFactoryModule) {
  throw new Error(
    `Missing ${FACTORY_MODULE_ENV_VAR}. ` +
      `Set it to a module exporting a runtime mobile SQLite test database factory ` +
      `when ${REQUIRE_FACTORY_ENV_VAR}=1.`,
  )
}

if (runtimeFactoryModule) {
  const runtimeModule = (await import(
    toImportSpecifier(runtimeFactoryModule)
  )) as Record<string, unknown>
  const factoryExportName =
    process.env[FACTORY_EXPORT_ENV_VAR]?.trim() || DEFAULT_FACTORY_EXPORT_NAME
  const selectedExport =
    runtimeModule[factoryExportName] ?? runtimeModule.default
  const resolvedFactory = await resolveFactoryFromExport(selectedExport)

  if (!resolvedFactory) {
    throw new Error(
      `Unable to resolve a mobile SQLite test database factory from "${runtimeFactoryModule}". ` +
        `Expected export "${factoryExportName}" (or default export) to be a database factory ` +
        `or a zero-argument function that returns one.`,
    )
  }

  globalThis.__tanstackDbCreateMobileSQLiteTestDatabase = resolvedFactory
}
