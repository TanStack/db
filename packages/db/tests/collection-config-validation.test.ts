import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
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
} from '../src/errors'

describe(`createCollection runtime config validation`, () => {
  const validSync = { sync: () => {} }

  describe(`missing or invalid config`, () => {
    it(`should throw CollectionRequiresConfigError when no config is passed`, () => {
      // @ts-expect-error testing runtime behavior
      expect(() => createCollection()).toThrow(CollectionRequiresConfigError)
    })

    it(`should throw CollectionRequiresConfigError when null is passed`, () => {
      // @ts-expect-error testing runtime behavior
      expect(() => createCollection(null)).toThrow(
        CollectionRequiresConfigError,
      )
    })

    it(`should throw CollectionRequiresConfigError when a string is passed`, () => {
      // @ts-expect-error testing runtime behavior
      expect(() => createCollection(`not a config`)).toThrow(
        CollectionRequiresConfigError,
      )
    })

    it(`should throw CollectionRequiresConfigError when an array is passed`, () => {
      // @ts-expect-error testing runtime behavior
      expect(() => createCollection([])).toThrow(CollectionRequiresConfigError)
    })
  })

  describe(`getKey validation`, () => {
    it(`should throw CollectionRequiresGetKeyError when getKey is missing`, () => {
      // @ts-expect-error testing runtime behavior
      expect(() => createCollection({ sync: validSync })).toThrow(
        CollectionRequiresGetKeyError,
      )
    })

    it(`should throw InvalidGetKeyError when getKey is a string`, () => {
      expect(() =>
        // @ts-expect-error testing runtime behavior
        createCollection({ getKey: `id`, sync: validSync }),
      ).toThrow(InvalidGetKeyError)
    })

    it(`should throw InvalidGetKeyError when getKey is an object`, () => {
      expect(() =>
        // @ts-expect-error testing runtime behavior
        createCollection({ getKey: { field: `id` }, sync: validSync }),
      ).toThrow(InvalidGetKeyError)
    })

    it(`should include the actual type in the error message`, () => {
      try {
        // @ts-expect-error testing runtime behavior
        createCollection({ getKey: 42, sync: validSync })
        expect.unreachable()
      } catch (e: any) {
        expect(e).toBeInstanceOf(InvalidGetKeyError)
        expect(e.message).toContain(`number`)
      }
    })
  })

  describe(`sync validation`, () => {
    it(`should throw CollectionRequiresSyncConfigError when sync is missing`, () => {
      expect(() =>
        // @ts-expect-error testing runtime behavior
        createCollection({ getKey: (item: any) => item.id }),
      ).toThrow(CollectionRequiresSyncConfigError)
    })

    it(`should throw InvalidSyncConfigError when sync is a string`, () => {
      expect(() =>
        // @ts-expect-error testing runtime behavior
        createCollection({ getKey: (item: any) => item.id, sync: `sync` }),
      ).toThrow(InvalidSyncConfigError)
    })

    it(`should throw InvalidSyncConfigError when sync is a function`, () => {
      expect(() =>
        createCollection({
          getKey: (item: any) => item.id,
          // @ts-expect-error testing runtime behavior
          sync: () => {},
        }),
      ).toThrow(InvalidSyncConfigError)
    })

    it(`should throw InvalidSyncFunctionError when sync.sync is missing`, () => {
      expect(() =>
        // @ts-expect-error testing runtime behavior
        createCollection({ getKey: (item: any) => item.id, sync: {} }),
      ).toThrow(InvalidSyncFunctionError)
    })

    it(`should throw InvalidSyncFunctionError when sync.sync is a string`, () => {
      expect(() =>
        createCollection({
          getKey: (item: any) => item.id,
          // @ts-expect-error testing runtime behavior
          sync: { sync: `not a function` },
        }),
      ).toThrow(InvalidSyncFunctionError)
    })
  })

  describe(`callback option validation`, () => {
    it(`should throw InvalidCallbackOptionError when onInsert is not a function`, () => {
      expect(() =>
        createCollection({
          getKey: (item: any) => item.id,
          sync: validSync,
          // @ts-expect-error testing runtime behavior
          onInsert: `not a function`,
        }),
      ).toThrow(InvalidCallbackOptionError)
    })

    it(`should throw InvalidCallbackOptionError when onUpdate is not a function`, () => {
      expect(() =>
        createCollection({
          getKey: (item: any) => item.id,
          sync: validSync,
          // @ts-expect-error testing runtime behavior
          onUpdate: 42,
        }),
      ).toThrow(InvalidCallbackOptionError)
    })

    it(`should throw InvalidCallbackOptionError when onDelete is not a function`, () => {
      expect(() =>
        createCollection({
          getKey: (item: any) => item.id,
          sync: validSync,
          // @ts-expect-error testing runtime behavior
          onDelete: true,
        }),
      ).toThrow(InvalidCallbackOptionError)
    })

    it(`should throw InvalidCallbackOptionError when compare is not a function`, () => {
      expect(() =>
        createCollection({
          getKey: (item: any) => item.id,
          sync: validSync,
          // @ts-expect-error testing runtime behavior
          compare: `ascending`,
        }),
      ).toThrow(InvalidCallbackOptionError)
    })

    it(`should include the option name in the error message`, () => {
      try {
        createCollection({
          getKey: (item: any) => item.id,
          sync: validSync,
          // @ts-expect-error testing runtime behavior
          onInsert: 42,
        })
        expect.unreachable()
      } catch (e: any) {
        expect(e).toBeInstanceOf(InvalidCallbackOptionError)
        expect(e.message).toContain(`onInsert`)
        expect(e.message).toContain(`number`)
      }
    })
  })

  describe(`option type validation`, () => {
    it(`should throw InvalidOptionTypeError when id is not a string`, () => {
      expect(() =>
        createCollection({
          // @ts-expect-error testing runtime behavior
          id: 42,
          getKey: (item: any) => item.id,
          sync: validSync,
        }),
      ).toThrow(InvalidOptionTypeError)
    })

    it(`should throw InvalidOptionTypeError when gcTime is not a number`, () => {
      expect(() =>
        createCollection({
          getKey: (item: any) => item.id,
          sync: validSync,
          // @ts-expect-error testing runtime behavior
          gcTime: `5000`,
        }),
      ).toThrow(InvalidOptionTypeError)
    })

    it(`should throw InvalidOptionTypeError when gcTime is NaN`, () => {
      expect(() =>
        createCollection({
          getKey: (item: any) => item.id,
          sync: validSync,
          gcTime: NaN,
        }),
      ).toThrow(InvalidOptionTypeError)
    })

    it(`should accept gcTime as Infinity`, () => {
      const collection = createCollection({
        getKey: (item: any) => item.id,
        sync: validSync,
        gcTime: Infinity,
      })
      expect(collection).toBeDefined()
    })

    it(`should throw InvalidOptionTypeError when startSync is not a boolean`, () => {
      expect(() =>
        createCollection({
          getKey: (item: any) => item.id,
          sync: validSync,
          // @ts-expect-error testing runtime behavior
          startSync: `true`,
        }),
      ).toThrow(InvalidOptionTypeError)
    })

    it(`should throw InvalidOptionTypeError when autoIndex is an invalid value`, () => {
      expect(() =>
        createCollection({
          getKey: (item: any) => item.id,
          sync: validSync,
          // @ts-expect-error testing runtime behavior
          autoIndex: `lazy`,
        }),
      ).toThrow(InvalidOptionTypeError)
    })

    it(`should throw InvalidOptionTypeError when syncMode is an invalid value`, () => {
      expect(() =>
        createCollection({
          getKey: (item: any) => item.id,
          sync: validSync,
          // @ts-expect-error testing runtime behavior
          syncMode: `lazy`,
        }),
      ).toThrow(InvalidOptionTypeError)
    })

    it(`should throw InvalidOptionTypeError when utils is not an object`, () => {
      expect(() =>
        createCollection({
          getKey: (item: any) => item.id,
          sync: validSync,
          // @ts-expect-error testing runtime behavior
          utils: `not an object`,
        }),
      ).toThrow(InvalidOptionTypeError)
    })

    it(`should throw InvalidOptionTypeError when utils is an array`, () => {
      expect(() =>
        createCollection({
          getKey: (item: any) => item.id,
          sync: validSync,
          utils: [() => {}],
        }),
      ).toThrow(InvalidOptionTypeError)
    })
  })

  describe(`unknown property detection`, () => {
    it(`should throw UnknownCollectionConfigError for unknown properties`, () => {
      expect(() =>
        createCollection({
          getKey: (item: any) => item.id,
          sync: validSync,
          // @ts-expect-error testing runtime behavior
          unknownProp: true,
        }),
      ).toThrow(UnknownCollectionConfigError)
    })

    it(`should suggest close matches for typos`, () => {
      try {
        createCollection({
          // @ts-expect-error testing runtime behavior
          getkey: (item: any) => item.id,
          sync: validSync,
        })
        expect.unreachable()
      } catch (e: any) {
        expect(e).toBeInstanceOf(UnknownCollectionConfigError)
        expect(e.message).toContain(`getkey`)
        expect(e.message).toContain(`getKey`)
      }
    })

    it(`should suggest "onInsert" for "oninsert"`, () => {
      try {
        createCollection({
          getKey: (item: any) => item.id,
          sync: validSync,
          // @ts-expect-error testing runtime behavior
          oninsert: async () => {},
        })
        expect.unreachable()
      } catch (e: any) {
        expect(e).toBeInstanceOf(UnknownCollectionConfigError)
        expect(e.message).toContain(`onInsert`)
      }
    })

    it(`should list all valid properties in the error message`, () => {
      try {
        createCollection({
          getKey: (item: any) => item.id,
          sync: validSync,
          // @ts-expect-error testing runtime behavior
          foo: true,
        })
        expect.unreachable()
      } catch (e: any) {
        expect(e).toBeInstanceOf(UnknownCollectionConfigError)
        expect(e.message).toContain(`Valid config properties`)
        expect(e.message).toContain(`getKey`)
        expect(e.message).toContain(`sync`)
      }
    })

    it(`should detect multiple unknown properties at once`, () => {
      try {
        createCollection({
          getKey: (item: any) => item.id,
          sync: validSync,
          // @ts-expect-error testing runtime behavior
          foo: true,
          bar: false,
        })
        expect.unreachable()
      } catch (e: any) {
        expect(e).toBeInstanceOf(UnknownCollectionConfigError)
        expect(e.message).toContain(`foo`)
        expect(e.message).toContain(`bar`)
      }
    })
  })

  describe(`valid configs should pass validation`, () => {
    it(`should accept a minimal valid config`, () => {
      const collection = createCollection({
        getKey: (item: any) => item.id,
        sync: validSync,
      })
      expect(collection).toBeDefined()
    })

    it(`should accept a config with all optional properties`, () => {
      const collection = createCollection({
        id: `test`,
        getKey: (item: any) => item.id,
        sync: validSync,
        gcTime: 5000,
        startSync: false,
        autoIndex: `eager`,
        compare: (a: any, b: any) => a.id - b.id,
        syncMode: `eager`,
        onInsert: async () => {},
        onUpdate: async () => {},
        onDelete: async () => {},
        utils: { helper: () => {} },
      })
      expect(collection).toBeDefined()
    })

    it(`should accept undefined optional properties`, () => {
      const collection = createCollection({
        getKey: (item: any) => item.id,
        sync: validSync,
        id: undefined,
        gcTime: undefined,
        startSync: undefined,
        onInsert: undefined,
        onUpdate: undefined,
        onDelete: undefined,
      })
      expect(collection).toBeDefined()
    })
  })
})
