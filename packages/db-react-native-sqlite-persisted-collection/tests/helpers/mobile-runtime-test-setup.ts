import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { MobileSQLiteTestDatabaseFactory } from './op-sqlite-test-db'

const FACTORY_MODULE_ENV_VAR = `TANSTACK_DB_MOBILE_SQLITE_FACTORY_MODULE`
const FACTORY_EXPORT_ENV_VAR = `TANSTACK_DB_MOBILE_SQLITE_FACTORY_EXPORT`
const DEFAULT_FACTORY_EXPORT_NAME = `createMobileSQLiteTestDatabaseFactory`

type MobileSQLiteFactoryExport =
  | MobileSQLiteTestDatabaseFactory
  | (() => MobileSQLiteTestDatabaseFactory)
  | (() => Promise<MobileSQLiteTestDatabaseFactory>)

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
): Promise<MobileSQLiteTestDatabaseFactory | null> {
  if (typeof exportedFactory !== `function`) {
    return null
  }

  const candidate = exportedFactory as MobileSQLiteFactoryExport
  if (candidate.length > 0) {
    return candidate as MobileSQLiteTestDatabaseFactory
  }

  const resolvedFactory = await (
    candidate as
      | (() => MobileSQLiteTestDatabaseFactory)
      | (() => Promise<MobileSQLiteTestDatabaseFactory>)
  )()
  if (typeof resolvedFactory !== `function`) {
    return null
  }

  return resolvedFactory
}

globalThis.__tanstackDbCreateMobileSQLiteTestDatabase = undefined

const runtimeFactoryModule = process.env[FACTORY_MODULE_ENV_VAR]?.trim()
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
