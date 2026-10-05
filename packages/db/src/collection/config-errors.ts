// Internal development diagnostics; keep these out of the public exports.
import { CollectionConfigurationError } from '../errors'

export class CollectionRequiresGetKeyError extends CollectionConfigurationError {
  constructor() {
    super(
      `Collection requires a "getKey" function in the config.\n\n` +
        `The getKey function extracts a unique identifier from each item.\n\n` +
        `Example:\n` +
        `  createCollection({\n` +
        `    getKey: (item) => item.id,\n` +
        `    sync: { sync: () => {} },\n` +
        `  })`,
    )
  }
}

export class InvalidGetKeyError extends CollectionConfigurationError {
  constructor(actualType: string) {
    super(
      `"getKey" must be a function, but received ${actualType}.\n\n` +
        `Example:\n` +
        `  createCollection({\n` +
        `    getKey: (item) => item.id,\n` +
        `    sync: { sync: () => {} },\n` +
        `  })`,
    )
  }
}

export class InvalidSyncConfigError extends CollectionConfigurationError {
  constructor(actualType: string) {
    super(
      `"sync" must be an object with a "sync" function, but received ${actualType}.\n\n` +
        `Example:\n` +
        `  createCollection({\n` +
        `    getKey: (item) => item.id,\n` +
        `    sync: {\n` +
        `      sync: ({ begin, write, commit, markReady }) => {\n` +
        `        // your sync logic\n` +
        `      },\n` +
        `    },\n` +
        `  })`,
    )
  }
}

export class InvalidSyncFunctionError extends CollectionConfigurationError {
  constructor(actualType: string) {
    super(
      `"sync.sync" must be a function, but received ${actualType}.\n\n` +
        `The sync property should be an object containing a sync function:\n` +
        `  sync: {\n` +
        `    sync: ({ begin, write, commit, markReady }) => {\n` +
        `      // your sync logic\n` +
        `    },\n` +
        `  }`,
    )
  }
}

export class InvalidCallbackOptionError extends CollectionConfigurationError {
  constructor(optionName: string, actualType: string) {
    super(`"${optionName}" must be a function, but received ${actualType}.`)
  }
}

export class InvalidOptionTypeError extends CollectionConfigurationError {
  constructor(optionName: string, expectedType: string, actualType: string) {
    super(
      `"${optionName}" must be ${expectedType}, but received ${actualType}.`,
    )
  }
}
