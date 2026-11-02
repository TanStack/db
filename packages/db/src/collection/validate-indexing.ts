import { CollectionConfigurationError } from '../errors.js'
import { codedMessage, devBuild } from '../error-message.js'
import type { CollectionConfig } from '../types.js'

/** Apply the same admission rule before construction or cached preload reuse. */
export function validateCollectionIndexing(
  config: Pick<CollectionConfig, `autoIndex` | `defaultIndexType`>,
): void {
  if (config.autoIndex === `eager` && !config.defaultIndexType) {
    throw new CollectionConfigurationError(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `autoIndex: 'eager' requires defaultIndexType to be set. ` +
            `Import an index type and set it:\n` +
            `  import { BasicIndex } from '@tanstack/db'\n` +
            `  createCollection({ defaultIndexType: BasicIndex, autoIndex: 'eager', ... })`
        : codedMessage(206),
    )
  }
}
