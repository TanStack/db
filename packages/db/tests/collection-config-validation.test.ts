import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { BasicIndex } from '../src/indexes/basic-index'
import {
  CollectionRequiresGetKeyError,
  InvalidCallbackOptionError,
  InvalidGetKeyError,
  InvalidOptionTypeError,
  InvalidSyncConfigError,
  InvalidSyncFunctionError,
} from '../src/collection/config-errors'
import {
  CollectionRequiresConfigError,
  CollectionRequiresSyncConfigError,
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
      expect(() => createCollection(null)).toThrow()
    })

    it(`should throw CollectionRequiresConfigError when a string is passed`, () => {
      // @ts-expect-error testing runtime behavior
      expect(() => createCollection(`not a config`)).toThrow()
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

    it.each([0, -1, NaN, Infinity, -Infinity])(
      `accepts gcTime %s to disable automatic garbage collection`,
      (gcTime) => {
        expect(() =>
          createCollection({
            getKey: (item: { id: number }) => item.id,
            sync: validSync,
            gcTime,
          }),
        ).not.toThrow()
      },
    )

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

  describe(`likely config misspellings`, () => {
    afterEach(() => vi.restoreAllMocks())

    const baseConfig = {
      getKey: (item: { id: number }) => item.id,
      sync: validSync,
    }

    it.each([
      [`oninsert`, `onInsert`],
      [`onUdpate`, `onUpdate`],
      [`stratSync`, `startSync`],
      [`syncmode`, `syncMode`],
      [`defaultIndxeType`, `defaultIndexType`],
      [`shcema`, `schema`],
      [`utlis`, `utils`],
    ])(`warns about %s without rejecting the config`, (unknown, suggestion) => {
      const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
      const config = { ...baseConfig, [unknown]: () => {} }
      expect(() => createCollection(config)).not.toThrow()
      expect(warn).toHaveBeenCalledOnce()
      expect(warn.mock.calls[0]![0]).toContain(`"${unknown}"`)
      expect(warn.mock.calls[0]![0]).toContain(`"${suggestion}"`)
    })

    it.each([
      `adapterMetadata`,
      `parse`,
      `serialize`,
      `serializer`,
      `rowUpdateMode`,
      `onLoad`,
      `onLoadSubset`,
      `schemas`,
      `scheme`,
      `getKeys`,
      `ids`,
      `di`,
      `sycn`,
      `_oninsert`,
    ])(`silently accepts the extra property %s`, (key) => {
      const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
      const config = { ...baseConfig, [key]: `adapter value` }
      expect(() => createCollection(config)).not.toThrow()
      expect(warn).not.toHaveBeenCalled()
    })

    it(`does not warn when the correctly named option is also present`, () => {
      const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
      const config = { ...baseConfig, onInsert: async () => {}, oninsert: true }
      expect(() => createCollection(config)).not.toThrow()
      expect(warn).not.toHaveBeenCalled()
    })

    it(`reports a likely typo and still rejects a missing required function`, () => {
      const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
      expect(() =>
        createCollection({
          // @ts-expect-error getkey does not supply the required getKey
          getkey: (item: { id: number }) => item.id,
          sync: validSync,
        }),
      ).toThrow(CollectionRequiresGetKeyError)
      expect(warn).toHaveBeenCalledOnce()
      expect(warn.mock.calls[0]![0]).toContain(`"getKey"`)
    })

    it(`still rejects invalid core options alongside valid adapter metadata`, () => {
      const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
      const config = { ...baseConfig, getKey: 42, adapterMetadata: true }
      expect(() =>
        // @ts-expect-error getKey must be a function
        createCollection(config),
      ).toThrow(InvalidGetKeyError)
      expect(warn).not.toHaveBeenCalled()
    })

    it(`reports each likely typo without warning about unrelated metadata`, () => {
      const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
      const config = {
        ...baseConfig,
        oninsert: async () => {},
        onUdpate: async () => {},
        adapterMetadata: true,
      }
      expect(() => createCollection(config)).not.toThrow()
      expect(warn).toHaveBeenCalledTimes(2)
      expect(warn.mock.calls.flat().join(` `)).not.toContain(`adapterMetadata`)
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
        defaultIndexType: BasicIndex,
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
