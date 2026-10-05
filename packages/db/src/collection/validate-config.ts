import {
  CollectionRequiresConfigError,
  CollectionRequiresSyncConfigError,
} from '../errors'
import {
  CollectionRequiresGetKeyError,
  InvalidCallbackOptionError,
  InvalidGetKeyError,
  InvalidOptionTypeError,
  InvalidSyncConfigError,
  InvalidSyncFunctionError,
} from './config-errors'

/**
 * Known top-level config properties for createCollection.
 * Extra properties are allowed; these names are only used for typo suggestions.
 */
const KNOWN_CONFIG_KEYS = new Set([
  `id`,
  `schema`,
  `getKey`,
  `sync`,
  `gcTime`,
  `startSync`,
  `autoIndex`,
  `defaultIndexType`,
  `compare`,
  `syncMode`,
  `defaultStringCollation`,
  `onInsert`,
  `onUpdate`,
  `onDelete`,
  `utils`,
  `singleResult`,
  // Metadata returned by persistedCollectionOptions.
  `persistence`,
])

// Limit suggestions to casing mistakes and adjacent swaps in longer names.
// Broader edit-distance matching can mistake adapter fields for core options.
function findLikelyTypo(
  key: string,
  config: Record<string, unknown>,
): string | undefined {
  for (const knownKey of KNOWN_CONFIG_KEYS) {
    if (knownKey in config) continue
    if (key.toLowerCase() === knownKey.toLowerCase()) return knownKey
    if (key.length < 5 || key.length !== knownKey.length) continue

    for (let i = 0; i < key.length - 1; i++) {
      const swapped = key.slice(0, i) + key[i + 1] + key[i] + key.slice(i + 2)
      if (swapped === knownKey) return knownKey
    }
  }
  return undefined
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

  // Adapter metadata is valid. Warn only when an extra key is likely a typo.
  for (const key of Object.keys(configObj)) {
    if (!KNOWN_CONFIG_KEYS.has(key) && !key.startsWith(`_`)) {
      const suggestion = findLikelyTypo(key, configObj)
      if (suggestion) {
        console.warn(
          `Possible misspelling in collection config: "${key}". Did you mean "${suggestion}"?`,
        )
      }
    }
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
    if (typeof configObj.gcTime !== `number`) {
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
    if (configObj.syncMode !== `eager` && configObj.syncMode !== `on-demand`) {
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
