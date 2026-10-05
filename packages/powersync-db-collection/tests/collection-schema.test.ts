import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { PowerSyncDatabase, Schema, Table, column } from '@powersync/node'
import { SchemaValidationError, createCollection } from '@tanstack/db'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import { powerSyncCollectionOptions } from '../src'
import { TEST_DATABASE_IMPLEMENTATION } from './test-db-implementation'
import type { StandardSchemaV1 } from '@standard-schema/spec'

const APP_SCHEMA = new Schema({
  documents: new Table({
    name: column.text,
    author: column.text,
    created_at: column.text, // Will be mapped to Date
    archived: column.integer, // Will be mapped to Boolean
  }),
})

const describePowerSyncSchema = TEST_DATABASE_IMPLEMENTATION
  ? describe
  : describe.skip

describePowerSyncSchema(`PowerSync Schema Integration`, () => {
  async function createDatabase() {
    const db = new PowerSyncDatabase({
      database: {
        dbFilename: `test.sqlite`,
        dbLocation: tmpdir(),
        implementation: TEST_DATABASE_IMPLEMENTATION,
      },
      schema: APP_SCHEMA,
    })
    onTestFinished(async () => {
      await db.disconnectAndClear()
      await db.close()
    })
    // Initial clear in case a test might have failed
    await db.disconnectAndClear()
    return db
  }

  function createDocumentsCollection(db: PowerSyncDatabase) {
    const collection = createCollection(
      powerSyncCollectionOptions({
        database: db,
        // We get typing and a default validator from this
        table: APP_SCHEMA.props.documents,
      }),
    )
    onTestFinished(() => collection.cleanup())
    return collection
  }

  describe(`schema`, () => {
    function expectInsertValidation(
      action: () => unknown,
      message: string,
      issue: { message: string; path: Array<string> },
    ) {
      let error: unknown
      try {
        action()
      } catch (caught) {
        error = caught
      }
      expect(error).toBeInstanceOf(SchemaValidationError)
      expect(error).toMatchObject({
        type: `insert`,
        message: expect.stringContaining(message),
        issues: expect.arrayContaining([issue]),
      })
    }

    /**
     * When using the SQLite types for TInput and TOutput, we provide a basic schema validator.
     */
    it(`should use basic runtime validations from automatic SQLite schema`, async () => {
      const db = await createDatabase()

      // the collection should infer types and validate with the schema
      const collection = createDocumentsCollection(db)
      try {
        await collection.stateWhenReady()
        const first = collection.insert({ id: randomUUID(), name: `aname` })
        const second = collection.insert({ id: randomUUID(), name: null })
        expect(collection.size).eq(2)
        await Promise.all([
          first.isPersisted.promise,
          second.isPersisted.promise,
        ])

        expectInsertValidation(
          () => collection.insert({} as any),
          `id field must be a string`,
          { message: `id field must be a string`, path: [`id`] },
        )
        expect(collection.size).eq(2)
      } finally {
        await collection.cleanup()
      }
    })

    /**
     * The TInput value can enforce additional validations.
     * This example uses the SQLite types as TInput and TOutput.
     */
    it(`should allow for advanced input validations`, async () => {
      const db = await createDatabase()

      const errorMessage = `Name must be at least 3 characters`
      /**
       * This has additional validations on TInput.
       * These validations will be applied for mutations: e.g. `insert`, `update`/
       * Validations include:
       *  - `name`, `author` and `created_at` are required
       *  - `name` must be at least 3 characters long
       */
      const schema = z.object({
        id: z.string(),
        name: z.string().min(3, { message: errorMessage }),
        archived: z.number(),
        author: z.string(),
        created_at: z.string(),
      })

      const collection = createCollection(
        powerSyncCollectionOptions({
          database: db,
          table: APP_SCHEMA.props.documents,
          schema,
          onDeserializationError: () => {},
        }),
      )
      try {
        expectInsertValidation(
          () =>
            collection.insert({
              id: randomUUID(),
              name: `2`,
              author: `name`,
              created_at: new Date().toISOString(),
              archived: 0,
            }),
          errorMessage,
          { message: errorMessage, path: [`name`] },
        )
        expect(collection.size).eq(0)
        expectInsertValidation(
          () => collection.insert({} as any),
          `Required - path: id`,
          { message: `Required`, path: [`id`] },
        )
        expect(collection.size).eq(0)
      } finally {
        await collection.cleanup()
      }
    })

    /**
     * In this example the TInput and TOutput types are different.
     * In this example we use the SQLite types as the input. We don't need an additional deserialization schema.
     */
    it(`should allow custom/transformed input types - Input is SQLite`, async () => {
      const db = await createDatabase()

      /**
       * The input for `created_at` is string, while it's presented as a `Date` in TOutput
       */
      const schema = z.object({
        id: z.string(),
        name: z.string().nullable(),
        archived: z.number().nullable(),
        author: z.string().nullable(),
        created_at: z
          .string()
          .nullable()
          .transform((val) => val && new Date(val)),
      })

      const collection = createCollection(
        powerSyncCollectionOptions({
          database: db,
          table: APP_SCHEMA.props.documents,
          schema,
          onDeserializationError: () => {},
        }),
      )
      const testDate = new Date(`2024-03-14T01:59:26.535Z`)
      const id = randomUUID()
      try {
        const result = collection.insert({
          id,
          name: `document`,
          author: `nanme`,
          created_at: testDate.toISOString(),
          archived: 0,
        })
        const item = collection.get(id)
        expect(item?.created_at instanceof Date).true
        expect(
          item?.created_at instanceof Date
            ? item.created_at.getTime()
            : undefined,
        ).eq(1710381566535)
        await result.isPersisted.promise
        expect(
          await db.getAll(
            `SELECT id, name, author, created_at, archived FROM documents WHERE id = ?`,
            [id],
          ),
        ).toEqual([
          {
            id,
            name: `document`,
            author: `nanme`,
            created_at: `2024-03-14T01:59:26.535Z`,
            archived: 0,
          },
        ])

        await db.execute(
          `INSERT INTO documents (id, name, author, created_at, archived) VALUES (?, ?, ?, ?, ?)`,
          [`inbound-sqlite`, `inbound`, `peer`, `2025-06-07T08:09:10.123Z`, 1],
        )
        await vi.waitFor(() => {
          const inbound = collection.get(`inbound-sqlite`)
          expect(inbound?.created_at).toBeInstanceOf(Date)
          expect(inbound).toMatchObject({
            id: `inbound-sqlite`,
            name: `inbound`,
            author: `peer`,
            archived: 1,
          })
          expect(
            inbound?.created_at instanceof Date
              ? inbound.created_at.getTime()
              : undefined,
          ).toBe(1749283750123)
        })
      } finally {
        await collection.cleanup()
      }
    })

    /**
     * In this example the TInput and TOutput types are different.
     * In this example we use custom types for TInput. This requires an additional schema for validating
     * incoming items from the sync stream (which is typed as SQLite)
     */
    it(`should allow custom/transformed input types - Input is different from SQLite`, async () => {
      const db = await createDatabase()

      /**
       * The input for `created_at` is unix epoch, while it's presented as a `Date` in TOutput
       */
      const schema = z.object({
        id: z.string(),
        name: z.string().nullable(),
        // We want to use booleans as the input here
        archived: z.boolean().nullable(),
        author: z.string().nullable(),
        created_at: z.date().nullable(),
      })

      const collection = createCollection(
        powerSyncCollectionOptions({
          database: db,
          table: APP_SCHEMA.props.documents,
          schema,
          /**
           * This needs to convert the SQLite types (which are different from TInput in this case)
           * to TOutput
           */
          deserializationSchema: z.object({
            id: z.string(),
            name: z.string().nullable(),
            archived: z
              .number()
              .nullable()
              .transform((val) => (val ? val != 0 : null)),
            author: z.string().nullable(),
            // In this case val is an ISO date string from SQLite
            created_at: z
              .string()
              .nullable()
              .transform((val) => (val ? new Date(val) : null)),
          }),
          onDeserializationError: () => {},
        }),
      )
      const testDate = new Date(`2024-03-14T01:59:26.535Z`)
      const id = randomUUID()
      try {
        const result = collection.insert({
          id,
          name: `document`,
          author: `nanme`,
          created_at: testDate,
          archived: false,
        })
        const item = collection.get(id)
        expect(item?.created_at instanceof Date).true
        expect(item?.created_at?.getTime()).eq(1710381566535)
        expect(item?.archived).toBe(false)
        await result.isPersisted.promise
        expect(
          await db.getAll(
            `SELECT id, name, author, created_at, archived FROM documents WHERE id = ?`,
            [id],
          ),
        ).toEqual([
          {
            id,
            name: `document`,
            author: `nanme`,
            created_at: `2024-03-14T01:59:26.535Z`,
            archived: 0,
          },
        ])

        await db.execute(
          `INSERT INTO documents (id, name, author, created_at, archived) VALUES (?, ?, ?, ?, ?)`,
          [`inbound-custom`, `inbound`, `peer`, `2025-06-07T08:09:10.123Z`, 0],
        )
        await vi.waitFor(() => {
          const inbound = collection.get(`inbound-custom`)
          expect(inbound?.created_at).toBeInstanceOf(Date)
          // This fixture's configured transform maps SQLite zero to null.
          expect(inbound).toMatchObject({
            id: `inbound-custom`,
            name: `inbound`,
            author: `peer`,
            archived: null,
          })
          expect(inbound?.created_at?.getTime()).toBe(1749283750123)
        })
      } finally {
        await collection.cleanup()
      }
    })

    /**
     * In this example we contain a TOutput field type which requires custom serialization for SQLite
     */
    it(`should allow for custom serializers`, async () => {
      const db = await createDatabase()

      class MyDataClass {
        constructor(public options: { value: string }) {}
      }

      /**
       * Here name is stored as a Buffer. We can't serialize this to SQLite automatically.
       * We need to provide a serializer.
       */
      const schema = z.object({
        id: z.string(),
        name: z
          .string()
          .nullable()
          .transform((value) => (value ? new MyDataClass({ value }) : null)),
        archived: z.number().nullable(),
        author: z.string().nullable(),
        created_at: z.string().nullable(),
      })

      const collection = createCollection(
        powerSyncCollectionOptions({
          database: db,
          table: APP_SCHEMA.props.documents,
          schema,
          // This is used to serialize to SQLite
          serializer: {
            name: (holder) => holder?.options.value || null,
          },
          deserializationSchema: schema,
          onDeserializationError: () => {},
        }),
      )
      const id = randomUUID()
      try {
        const result = collection.insert({
          id,
          name: `document`,
          author: `name`,
          created_at: `2024-03-14T01:59:26.535Z`,
          archived: 0,
        })
        const item = collection.get(id)
        await result.isPersisted.promise
        expect(item?.name instanceof MyDataClass).true
        expect(item?.name?.options.value).eq(`document`)
        expect(
          await db.getAll(
            `SELECT id, name, author, created_at, archived FROM documents WHERE id = ?`,
            [id],
          ),
        ).toEqual([
          {
            id,
            name: `document`,
            author: `name`,
            created_at: `2024-03-14T01:59:26.535Z`,
            archived: 0,
          },
        ])

        await db.execute(
          `INSERT INTO documents (id, name, author, created_at, archived) VALUES (?, ?, ?, ?, ?)`,
          [`inbound-class`, `from-sql`, `peer`, `2025-06-07T08:09:10.123Z`, 1],
        )
        await vi.waitFor(() => {
          const inbound = collection.get(`inbound-class`)
          expect(inbound?.name).toBeInstanceOf(MyDataClass)
          expect(inbound?.name?.options.value).toBe(`from-sql`)
          expect(inbound).toMatchObject({
            id: `inbound-class`,
            author: `peer`,
            created_at: `2025-06-07T08:09:10.123Z`,
            archived: 1,
          })
        })
      } finally {
        await collection.cleanup()
      }
    })

    /**
     * We sync data which cannot be validated by the schema. This is a fatal error.
     */
    it(`should catch deserialization errors`, async () => {
      const db = await createDatabase()

      /**
       * Here name is stored as a Buffer. We can't serialize this to SQLite automatically.
       * We need to provide a serializer.
       */
      const schema = z.object({
        id: z.string(),
        name: z.string(),
        archived: z.number(),
        author: z.string(),
        created_at: z.string(),
      })

      const onError = vi.fn((() => {}) as (
        error: StandardSchemaV1.FailureResult,
      ) => void)

      const collection = createCollection(
        powerSyncCollectionOptions({
          database: db,
          table: APP_SCHEMA.props.documents,
          schema,
          onDeserializationError: onError,
        }),
      )
      onTestFinished(() => collection.cleanup())

      await collection.stateWhenReady()

      // The columns are not nullable in the schema
      // Write invalid data to SQLite, this simulates a sync
      await db.execute(`INSERT INTO documents(id) VALUES(uuid())`)

      await vi.waitFor(
        () => {
          const issues = onError.mock.lastCall?.[0]?.issues
          expect(issues).toBeDefined()
          // Each column which should have been defined
          expect(issues?.length).eq(4)
        },
        { timeout: 1000 },
      )
    })
  })
})
