// The property ids and replay owners of the oracles that moved every test
// registration into oracleProperty (the declareOracle removal, 2026-11-11),
// by area. oracle-config.ts registers the ids; oracle-replay-manifest.ts maps
// each to its replay owner. Each is an enumerated source.
import * as adapters from './adapters.js'
import * as dbCollection from './db-collection.js'
import * as dbCollectionE2e from './db-collection-e2e.js'
import * as dbCore from './db-core.js'
import * as dbQueryIncludes from './db-query-includes.js'
import * as dbQueryOrdered from './db-query-ordered.js'
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
  dbQueryIncludes,
  dbQueryOrdered,
  frameworksIvm,
  sqlite,
]

export const convertedProperties: ReadonlyArray<string> = groups.flatMap(
  (group) => group.properties,
)
export const convertedOwners: ReadonlyArray<ConvertedOwnerGroup> =
  groups.flatMap((group) => group.owners)
