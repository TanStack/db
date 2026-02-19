import {
  CollectionRequiresConfigError,
  CollectionRequiresGetKeyError,
  CollectionRequiresSyncConfigError,
  InvalidCallbackOptionError,
  InvalidGetKeyError,
  InvalidOptionTypeError,
  InvalidSyncConfigError,
  InvalidSyncFunctionError,
  UnknownCollectionConfigError,
} from '../errors'

/**
 * All valid top-level config properties for createCollection.
 * Used for unknown-property detection.
 */
const VALID_CONFIG_KEYS = new Set([
  `id`,
  `schema`,
  `getKey`,
  `sync`,
  `gcTime`,
  `startSync`,
  `autoIndex`,
  `compare`,
  `syncMode`,
  `defaultStringCollation`,
  `onInsert`,
  `onUpdate`,
  `onDelete`,
  `utils`,
  `singleResult`,
])

/**
 * Compute Levenshtein distance between two strings for typo detection.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: Array<Array<number>> = Array.from({ length: m + 1 }, () =>
    Array.from({ length: n + 1 }, () => 0),
  )
  for (let i = 0; i <= m; i++) dp[i]![0] = i
  for (let j = 0; j <= n; j++) dp[0]![j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1]![j - 1]!
          : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!)
    }
  }
  return dp[m]![n]!
}

/**
 * Find the closest matching valid config key for an unknown key.
 * Returns the suggestion if within edit distance 3, otherwise undefined.
 */
function findClosestKey(unknownKey: string): string | undefined {
  let bestMatch: string | undefined
  let bestDistance = Infinity
  for (const validKey of VALID_CONFIG_KEYS) {
    const distance = levenshtein(unknownKey.toLowerCase(), validKey.toLowerCase())
    if (distance < bestDistance) {
      bestDistance = distance
      bestMatch = validKey
    }
  }
  return bestDistance <= 3 ? bestMatch : undefined
}

function describeType(value: unknown): string {
  if (value === null) return `null`
  if (value === undefined) return `undefined`
  if (Array.isArray(value)) return `an array`
  return typeof value
}

/**
 * Validates the collection config at runtime, providing clear error messages
 * for common misconfiguration mistakes that would otherwise surface as
 * unreadable TypeScript errors.
 *
 * This runs before the config is passed to CollectionImpl, catching issues
 * early with actionable error messages.
 */
export function validateCollectionConfig(config: unknown): void {
  // Check config exists and is an object
  if (!config || typeof config !== `object` || Array.isArray(config)) {
    throw new CollectionRequiresConfigError()
  }

  const configObj = config as Record<string, unknown>

  // Check for unknown properties (typo detection)
  // Skip properties starting with _ (internal/private convention)
  const unknownKeys: Array<string> = []
  const suggestions: Array<{ unknown: string; suggestion: string }> = []
  for (const key of Object.keys(configObj)) {
    if (!VALID_CONFIG_KEYS.has(key) && !key.startsWith(`_`)) {
      unknownKeys.push(key)
      const suggestion = findClosestKey(key)
      if (suggestion) {
        suggestions.push({ unknown: key, suggestion })
      }
    }
  }
  if (unknownKeys.length > 0) {
    throw new UnknownCollectionConfigError(unknownKeys, suggestions)
  }

  // Validate getKey
  if (!(`getKey` in configObj) || configObj.getKey === undefined) {
    throw new CollectionRequiresGetKeyError()
  }
  if (typeof configObj.getKey !== `function`) {
    throw new InvalidGetKeyError(describeType(configObj.getKey))
  }

  // Validate sync
  if (!configObj.sync) {
    throw new CollectionRequiresSyncConfigError()
  }
  if (typeof configObj.sync !== `object` || Array.isArray(configObj.sync)) {
    throw new InvalidSyncConfigError(describeType(configObj.sync))
  }
  const syncObj = configObj.sync as Record<string, unknown>
  if (typeof syncObj.sync !== `function`) {
    throw new InvalidSyncFunctionError(describeType(syncObj.sync))
  }

  // Validate callback options
  const callbackOptions = [
    `onInsert`,
    `onUpdate`,
    `onDelete`,
    `compare`,
  ] as const
  for (const optionName of callbackOptions) {
    if (
      optionName in configObj &&
      configObj[optionName] !== undefined &&
      typeof configObj[optionName] !== `function`
    ) {
      throw new InvalidCallbackOptionError(
        optionName,
        describeType(configObj[optionName]),
      )
    }
  }

  // Validate id
  if (`id` in configObj && configObj.id !== undefined) {
    if (typeof configObj.id !== `string`) {
      throw new InvalidOptionTypeError(
        `id`,
        `a string`,
        describeType(configObj.id),
      )
    }
  }

  // Validate gcTime
  if (`gcTime` in configObj && configObj.gcTime !== undefined) {
    if (typeof configObj.gcTime !== `number` || Number.isNaN(configObj.gcTime)) {
      throw new InvalidOptionTypeError(
        `gcTime`,
        `a number`,
        describeType(configObj.gcTime),
      )
    }
  }

  // Validate startSync
  if (`startSync` in configObj && configObj.startSync !== undefined) {
    if (typeof configObj.startSync !== `boolean`) {
      throw new InvalidOptionTypeError(
        `startSync`,
        `a boolean`,
        describeType(configObj.startSync),
      )
    }
  }

  // Validate autoIndex
  if (`autoIndex` in configObj && configObj.autoIndex !== undefined) {
    if (configObj.autoIndex !== `off` && configObj.autoIndex !== `eager`) {
      throw new InvalidOptionTypeError(
        `autoIndex`,
        `"off" or "eager"`,
        String(configObj.autoIndex),
      )
    }
  }

  // Validate syncMode
  if (`syncMode` in configObj && configObj.syncMode !== undefined) {
    if (
      configObj.syncMode !== `eager` &&
      configObj.syncMode !== `on-demand`
    ) {
      throw new InvalidOptionTypeError(
        `syncMode`,
        `"eager" or "on-demand"`,
        String(configObj.syncMode),
      )
    }
  }

  // Validate utils
  if (`utils` in configObj && configObj.utils !== undefined) {
    if (
      typeof configObj.utils !== `object` ||
      configObj.utils === null ||
      Array.isArray(configObj.utils)
    ) {
      throw new InvalidOptionTypeError(
        `utils`,
        `an object`,
        describeType(configObj.utils),
      )
    }
  }
}
