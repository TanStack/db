// Collects each conversion group's property ids and replay owners. See the
// header of any group file in this directory.
import * as adapters from './adapters.js'
import * as dbCollection from './db-collection.js'
import * as dbCollectionE2e from './db-collection-e2e.js'
import * as dbCore from './db-core.js'
import * as dbIndexeddbConformance from './db-indexeddb-conformance.js'
import * as dbQuery from './db-query.js'
import * as frameworksIvm from './frameworks-ivm.js'
import * as sqlite from './sqlite.js'

/** [owner file, prefix, suffixes] or, with the module that names them, a fourth entry. */
export type ConvertedOwnerGroup =
  readonly [string, string, string] | readonly [string, string, string, string]

const groups = [
  adapters,
  dbCollection,
  dbCollectionE2e,
  dbCore,
  dbIndexeddbConformance,
  dbQuery,
  frameworksIvm,
  sqlite,
]

export const convertedProperties: ReadonlyArray<string> = groups.flatMap(
  (group) => group.properties,
)
export const convertedOwners: ReadonlyArray<ConvertedOwnerGroup> =
  groups.flatMap((group) => group.owners)
