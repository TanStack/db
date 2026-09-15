import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pDefer from 'p-defer'
import {
  AttachmentState,
  AttachmentTable,
  Schema,
  Table,
  column,
} from '@powersync/common'
import { NodeFileSystemAdapter, PowerSyncDatabase } from '@powersync/node'
import {
  createCollection,
  isNull,
  liveQueryCollectionOptions,
  not,
} from '@tanstack/db'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { powerSyncCollectionOptions } from '../src'
import { TanStackDBAttachmentQueue } from '../src/attachments'
import { TEST_DATABASE_IMPLEMENTATION } from './test-db-implementation'
import type {
  AttachmentErrorHandler,
  RemoteStorageAdapter,
  WatchedAttachmentItem,
} from '@powersync/common'
import type { AttachmentQueueRow } from '../src/attachments'

// A minimal valid 1x1 pixel JPEG used as the remote payload for downloads.
const MOCK_JPEG_U8A = [
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01,
  0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]
const createMockJpegBuffer = (): ArrayBuffer =>
  new Uint8Array(MOCK_JPEG_U8A).buffer

const SYNC_INTERVAL_MS = 300
const WAIT_TIMEOUT = 8000

const APP_SCHEMA = new Schema({
  users: new Table({
    name: column.text,
    email: column.text,
    photo_id: column.text,
  }),
  attachments: new AttachmentTable(),
})

type WatchAttachments = (
  onUpdate: (attachments: Array<WatchedAttachmentItem>) => Promise<void>,
  signal: AbortSignal,
) => void

const describePowerSync = TEST_DATABASE_IMPLEMENTATION
  ? describe
  : describe.skip

describePowerSync(`PowerSync AttachmentQueue (TanStackDB)`, () => {
  async function setup(syncMode: `eager` | `on-demand` = `eager`) {
    const db = new PowerSyncDatabase({
      database: {
        dbFilename: `attachments-test-${randomUUID()}.sqlite`,
        dbLocation: tmpdir(),
        implementation: TEST_DATABASE_IMPLEMENTATION,
      },
      schema: APP_SCHEMA,
    })
    await db.disconnectAndClear()

    const localStorage = new NodeFileSystemAdapter(
      join(tmpdir(), `ps-attachments-${randomUUID()}`),
    )
    await localStorage.initialize()

    const uploadFile = vi.fn<RemoteStorageAdapter[`uploadFile`]>(() =>
      Promise.resolve(),
    )
    const downloadFile = vi.fn<RemoteStorageAdapter[`downloadFile`]>(() =>
      Promise.resolve(createMockJpegBuffer()),
    )
    const deleteFile = vi.fn<RemoteStorageAdapter[`deleteFile`]>(() =>
      Promise.resolve(),
    )
    const remoteStorage: RemoteStorageAdapter = {
      uploadFile,
      downloadFile,
      deleteFile,
    }

    const attachmentsCollection = createCollection(
      powerSyncCollectionOptions({
        database: db,
        table: APP_SCHEMA.props.attachments,
        syncMode,
      }),
    )
    const usersCollection = createCollection(
      powerSyncCollectionOptions({
        database: db,
        table: APP_SCHEMA.props.users,
      }),
    )
    await Promise.all([
      attachmentsCollection.stateWhenReady(),
      usersCollection.stateWhenReady(),
    ])

    onTestFinished(async () => {
      attachmentsCollection.cleanup()
      usersCollection.cleanup()
      await db.disconnectAndClear()
      await db.close()
      await localStorage.clear().catch(() => {})
    })

    function createQueue(
      overrides: {
        watchAttachments?: WatchAttachments
        archivedCacheLimit?: number
        errorHandler?: AttachmentErrorHandler
        remoteStorage?: RemoteStorageAdapter
      } = {},
    ) {
      const queue = new TanStackDBAttachmentQueue({
        db,
        attachmentsCollection,
        remoteStorage: overrides.remoteStorage ?? remoteStorage,
        localStorage,
        watchAttachments: overrides.watchAttachments ?? watchPhotoIds,
        syncIntervalMs: SYNC_INTERVAL_MS,
        archivedCacheLimit: overrides.archivedCacheLimit ?? 0,
        errorHandler: overrides.errorHandler,
      })
      onTestFinished(() => queue.stopSync())
      return queue
    }

    // Reports every photo_id referenced by the users collection as a watched
    // attachment. This mirrors how an application links its domain model to the
    // attachment queue using a TanStack DB live query rather than a raw SQL
    // watch: the `photo_id IS NOT NULL` filter lives in the query, and each
    // change re-emits the full set of referenced ids.
    const watchPhotoIdsWith = (
      toItem: (photoId: string) => WatchedAttachmentItem,
    ): WatchAttachments => {
      return async (onUpdate, signal) => {
        const livePhotoIds = createCollection(
          liveQueryCollectionOptions({
            query: (q) =>
              q
                .from({ user: usersCollection })
                .where(({ user }) => not(isNull(user.photo_id)))
                .select(({ user }) => ({ photo_id: user.photo_id })),
          }),
        )

        const emit = () =>
          void onUpdate(
            livePhotoIds.toArray
              .map((row) => row.photo_id)
              .filter((photoId): photoId is string => photoId != null)
              .map(toItem),
          )

        // Emit the current snapshot once ready, then on every change.
        await livePhotoIds.stateWhenReady()
        emit()
        const subscription = livePhotoIds.subscribeChanges(() => emit())

        signal.addEventListener(`abort`, () => {
          subscription.unsubscribe()
          livePhotoIds.cleanup()
        })
      }
    }

    const watchPhotoIds = watchPhotoIdsWith((id) => ({
      id,
      fileExtension: `jpg`,
    }))

    return {
      db,
      localStorage,
      remoteStorage,
      uploadFile,
      downloadFile,
      deleteFile,
      attachmentsCollection,
      usersCollection,
      createQueue,
      watchPhotoIds,
      watchPhotoIdsWith,
    }
  }

  /** Waits until the attachment with `id` reaches the expected state. */
  function waitForState<TRow extends { id: string }>(
    collection: { get: (id: string) => TRow | undefined },
    id: string,
    state: AttachmentState,
  ): Promise<TRow> {
    return vi.waitFor(
      () => {
        const attachment = collection.get(id)
        expect(
          (attachment as { state?: AttachmentState } | undefined)?.state,
        ).toBe(state)
        return attachment!
      },
      { timeout: WAIT_TIMEOUT, interval: 50 },
    )
  }

  describe(`save`, () => {
    it(`serializes successive watched snapshots through the SDK context`, async () => {
      const fixture = await setup()
      let update!: Parameters<WatchAttachments>[0]
      const queue = fixture.createQueue({
        archivedCacheLimit: 100,
        watchAttachments: (callback) => {
          update = callback
        },
      })
      const record = await queue.save({
        data: createMockJpegBuffer(),
        fileExtension: `jpg`,
      })
      await queue.syncStorage()
      await queue.startSync()
      const entered = pDefer<void>()
      const release = pDefer<void>()
      const held = queue.withAttachmentContext(async () => {
        entered.resolve()
        await release.promise
      })
      await entered.promise
      const completed: Array<number> = []
      const first = update([]).then(() => {
        completed.push(1)
      })
      const second = update([{ id: record.id, fileExtension: `jpg` }]).then(
        () => {
          completed.push(2)
        },
      )
      try {
        await Promise.resolve()
        expect(completed).toEqual([])
        release.resolve()
        await Promise.all([held, first, second])
        expect(completed).toEqual([1, 2])
        expect(
          await fixture.db.get(`SELECT state FROM attachments WHERE id = ?`, [
            record.id,
          ]),
        ).toEqual({ state: AttachmentState.SYNCED })
      } finally {
        release.resolve()
        await Promise.all([held, first, second])
      }
    })

    it(`preserves the winner file across two queue instances sharing storage`, async () => {
      const fixture = await setup()
      const first = fixture.createQueue()
      const second = fixture.createQueue()
      const entered = pDefer<void>()
      const release = pDefer<void>()
      const saveFile = fixture.localStorage.saveFile.bind(fixture.localStorage)
      const write = vi
        .spyOn(fixture.localStorage, `saveFile`)
        .mockImplementation(async (...args) => {
          const size = await saveFile(...args)
          if (write.mock.calls.length === 1) {
            entered.resolve()
            await release.promise
          }
          return size
        })
      const saving = first.save({
        id: `shared-id`,
        data: createMockJpegBuffer(),
        fileExtension: `jpg`,
      })
      try {
        await entered.promise
        await expect(
          second.save({
            id: `shared-id`,
            data: new Uint8Array([7, 8, 9]).buffer,
            fileExtension: `jpg`,
          }),
        ).rejects.toThrow(/already/)
        expect(write).toHaveBeenCalledTimes(1)
      } finally {
        release.resolve()
        await saving
      }
      const winner = await saving
      expect(
        new Uint8Array(await fixture.localStorage.readFile(winner.local_uri!)),
      ).toEqual(new Uint8Array(createMockJpegBuffer()))
    })

    it.each([`ready`, `cold`, `on-demand`] as const)(
      `preserves an existing file when reused through a %s collection`,
      async (phase) => {
        const fixture = await setup()
        const original = await fixture.createQueue().save({
          id: `reused-after-reopen`,
          data: createMockJpegBuffer(),
          fileExtension: `jpg`,
        })
        const collection =
          phase === `ready`
            ? fixture.attachmentsCollection
            : createCollection(
                powerSyncCollectionOptions({
                  database: fixture.db,
                  table: APP_SCHEMA.props.attachments,
                  syncMode: phase === `on-demand` ? `on-demand` : `eager`,
                }),
              )
        onTestFinished(() => collection.cleanup())
        const queue = new TanStackDBAttachmentQueue({
          db: fixture.db,
          attachmentsCollection: collection,
          localStorage: fixture.localStorage,
          remoteStorage: fixture.remoteStorage,
          watchAttachments: () => {},
        })
        onTestFinished(() => queue.stopSync())
        if (phase !== `ready`)
          expect(collection.get(original.id)).toBeUndefined()
        await expect(
          queue.save({
            id: original.id,
            data: new Uint8Array([7, 8, 9]).buffer,
            fileExtension: `jpg`,
          }),
        ).rejects.toThrow()
        expect(
          await fixture.db.getOptional(
            `SELECT id FROM attachments WHERE id = ?`,
            [original.id],
          ),
        ).toEqual({ id: original.id })
        expect(await fixture.localStorage.fileExists(original.local_uri!)).toBe(
          true,
        )
        expect(
          new Uint8Array(
            await fixture.localStorage.readFile(original.local_uri!),
          ),
        ).toEqual(new Uint8Array(createMockJpegBuffer()))
      },
    )

    it(`cleans a partial write and releases its ID for retry`, async () => {
      const fixture = await setup()
      const write = fixture.localStorage.saveFile.bind(fixture.localStorage)
      const savedPaths: Array<string> = []
      vi.spyOn(fixture.localStorage, `saveFile`).mockImplementationOnce(
        async (uri, data) => {
          savedPaths.push(uri)
          await write(uri, data)
          throw new Error(`partial write failure`)
        },
      )
      const options = {
        id: `partial`,
        data: createMockJpegBuffer(),
        fileExtension: `jpg`,
      }
      await expect(fixture.createQueue().save(options)).rejects.toThrow(
        `partial write failure`,
      )
      expect(savedPaths).toHaveLength(1)
      expect(await fixture.localStorage.fileExists(savedPaths[0]!)).toBe(false)
      expect(
        await fixture.db.getOptional(
          `SELECT id FROM attachments WHERE id = ?`,
          [options.id],
        ),
      ).toBeNull()
      const saved = await fixture.createQueue().save(options)
      expect(await fixture.localStorage.fileExists(saved.local_uri!)).toBe(true)
    })

    it(`allows another queue to save a distinct ID while a write is held`, async () => {
      const fixture = await setup()
      const entered = pDefer<void>()
      const release = pDefer<void>()
      const write = fixture.localStorage.saveFile.bind(fixture.localStorage)
      vi.spyOn(fixture.localStorage, `saveFile`).mockImplementationOnce(
        async (...args) => {
          const size = await write(...args)
          entered.resolve()
          await release.promise
          return size
        },
      )
      const saving = fixture
        .createQueue()
        .save({
          id: `held`,
          data: createMockJpegBuffer(),
          fileExtension: `jpg`,
        })
      try {
        await entered.promise
        const other = await fixture
          .createQueue()
          .save({
            id: `other`,
            data: createMockJpegBuffer(),
            fileExtension: `jpg`,
          })
        expect(await fixture.localStorage.fileExists(other.local_uri!)).toBe(
          true,
        )
      } finally {
        release.resolve()
        await saving
      }
    })

    it.each([`before`, `after`] as const)(
      `preserves delete intent %s an SDK upload`,
      async (timing) => {
        const fixture = await setup()
        const queue = fixture.createQueue()
        const uploaded = pDefer<void>()
        const release = pDefer<void>()
        const remoteFiles = new Set<string>()
        fixture.uploadFile.mockImplementation(async (_, attachment) => {
          uploaded.resolve()
          await release.promise
          remoteFiles.add(attachment.id)
        })
        fixture.deleteFile.mockImplementation((attachment) => {
          remoteFiles.delete(attachment.id)
          return Promise.resolve()
        })
        const userId = randomUUID()
        const record = await queue.save({
          data: createMockJpegBuffer(),
          fileExtension: `jpg`,
          updateHook: (attachment) => {
            fixture.usersCollection.insert({
              id: userId,
              name: `owner`,
              email: null,
              photo_id: attachment.id,
            })
          },
        })
        let sync: Promise<void> | undefined
        try {
          if (timing !== `before`) {
            sync = queue.syncStorage()
            await uploaded.promise
            release.resolve()
            await sync
          }
          await queue.delete({
            id: record.id,
            updateHook: () => {
              fixture.usersCollection.update(userId, (row) => {
                row.photo_id = null
              })
            },
          })
          expect(
            await fixture.db.get(`SELECT state FROM attachments WHERE id = ?`, [
              record.id,
            ]),
          ).toEqual({ state: AttachmentState.QUEUED_DELETE })
          expect(
            await fixture.db.get(`SELECT photo_id FROM users WHERE id = ?`, [
              userId,
            ]),
          ).toEqual({ photo_id: null })
          release.resolve()
          await sync
          // Complete two real SDK passes, not a timeout waiting for a mock state.
          await queue.syncStorage()
          await queue.syncStorage()
          expect(fixture.deleteFile).toHaveBeenCalledTimes(1)
          expect(remoteFiles.has(record.id)).toBe(false)
          expect(await fixture.localStorage.fileExists(record.local_uri!)).toBe(
            false,
          )
        } finally {
          release.resolve()
          await sync
        }
      },
    )

    it(`writes the local file and inserts a QUEUED_UPLOAD row into the collection`, async () => {
      const { createQueue, attachmentsCollection, localStorage } = await setup()
      const queue = createQueue()

      const data = new Uint8Array(123).fill(42).buffer
      const record = await queue.save({
        data,
        fileExtension: `jpg`,
        mediaType: `image/jpeg`,
      })

      expect(record.size).toBe(123)
      expect(record.state).toBe(AttachmentState.QUEUED_UPLOAD)
      expect(record.media_type).toBe(`image/jpeg`)
      expect(record.filename).toBe(`${record.id}.jpg`)
      expect(record.has_synced).toBe(0)

      // The file should exist on disk at the returned local_uri.
      expect(await localStorage.fileExists(record.local_uri!)).toBe(true)

      // The row should be reflected in the collection once it syncs back.
      await waitForState(
        attachmentsCollection,
        record.id,
        AttachmentState.QUEUED_UPLOAD,
      )
    })

    it(`commits the updateHook mutation atomically with the attachment row`, async () => {
      const { createQueue, attachmentsCollection, usersCollection } =
        await setup()
      const queue = createQueue()

      const userId = randomUUID()
      const record = await queue.save({
        data: createMockJpegBuffer(),
        fileExtension: `jpg`,
        updateHook: (attachment) => {
          usersCollection.insert({
            id: userId,
            name: `steven`,
            email: `steven@journeyapps.com`,
            photo_id: attachment.id,
          })
        },
      })

      // Both the attachment and the linked user row should appear together.
      await waitForState(
        attachmentsCollection,
        record.id,
        AttachmentState.QUEUED_UPLOAD,
      )
      await vi.waitFor(
        () => {
          const user = usersCollection.get(userId)
          expect(user?.photo_id).toBe(record.id)
        },
        { timeout: WAIT_TIMEOUT, interval: 50 },
      )
    })

    it(`uploads the saved file and transitions it to SYNCED`, async () => {
      const {
        createQueue,
        attachmentsCollection,
        usersCollection,
        uploadFile,
      } = await setup()
      const queue = createQueue()
      await queue.startSync()

      const userId = randomUUID()
      const record = await queue.save({
        data: createMockJpegBuffer(),
        fileExtension: `jpg`,
        updateHook: (attachment) => {
          usersCollection.insert({
            id: userId,
            name: `steven`,
            email: `steven@journeyapps.com`,
            photo_id: attachment.id,
          })
        },
      })

      await waitForState(
        attachmentsCollection,
        record.id,
        AttachmentState.SYNCED,
      )

      expect(uploadFile).toHaveBeenCalled()
      const [, uploadedAttachment] = uploadFile.mock.calls[0]!
      expect(uploadedAttachment.id).toBe(record.id)
    })

    it(`honours a caller-supplied id`, async () => {
      const { createQueue } = await setup()
      const queue = createQueue()

      const id = `my-custom-id`
      const record = await queue.save({
        id,
        data: createMockJpegBuffer(),
        fileExtension: `png`,
      })

      expect(record.id).toBe(id)
      expect(record.filename).toBe(`${id}.png`)
    })

    it(`rejects a reused id without disturbing the existing attachment`, async () => {
      const { createQueue, attachmentsCollection, localStorage } = await setup()
      const queue = createQueue()

      const original = await queue.save({
        data: createMockJpegBuffer(),
        fileExtension: `jpg`,
      })

      await expect(
        queue.save({
          id: original.id,
          // A different payload, so an overwrite would be detectable by size alone.
          data: new Uint8Array(999).fill(7).buffer,
          fileExtension: `jpg`,
        }),
      ).rejects.toThrow(/already exists/)

      // Without the up-front check the reused id overwrites this file and cleanup
      // then deletes it, leaving the original record pointing at nothing.
      expect(await localStorage.fileExists(original.local_uri!)).toBe(true)
      expect(attachmentsCollection.get(original.id)?.size).toBe(original.size)
    })

    it(`keeps the winner's file intact when two saves race on the same id`, async () => {
      const { createQueue, attachmentsCollection, localStorage } = await setup()
      const queue = createQueue()

      const id = `contended-id`
      // Distinct payload sizes, so an overwrite is detectable from the file length
      const smallPayload = createMockJpegBuffer()
      const largePayload = new Uint8Array(999).fill(7).buffer
      expect(smallPayload.byteLength).not.toBe(largePayload.byteLength)

      // Both calls run their duplicate check before either has inserted
      const results = await Promise.allSettled([
        queue.save({ id, data: smallPayload, fileExtension: `jpg` }),
        queue.save({ id, data: largePayload, fileExtension: `jpg` }),
      ])

      const fulfilled = results.filter(
        (result): result is PromiseFulfilledResult<AttachmentQueueRow> =>
          result.status === `fulfilled`,
      )
      const rejected = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === `rejected`,
      )

      expect(fulfilled).toHaveLength(1)
      expect(rejected).toHaveLength(1)
      expect(rejected[0]!.reason).toEqual(
        expect.objectContaining({
          message: expect.stringMatching(/exists|being saved/),
        }),
      )

      const winner = fulfilled[0]!.value
      expect(attachmentsCollection.size).toBe(1)
      expect(attachmentsCollection.get(id)?.size).toBe(winner.size)

      // The loser's cleanup must not delete the file the winner's record points at
      expect(await localStorage.fileExists(winner.local_uri!)).toBe(true)
      const onDisk = await localStorage.readFile(winner.local_uri!)
      expect(onDisk.byteLength).toBe(winner.size)
    })

    it(`removes the local file and rolls back when the updateHook throws`, async () => {
      const {
        createQueue,
        attachmentsCollection,
        usersCollection,
        localStorage,
      } = await setup()
      const queue = createQueue()

      const id = randomUUID()
      let localUri: string | undefined

      await expect(
        queue.save({
          id,
          data: createMockJpegBuffer(),
          fileExtension: `jpg`,
          updateHook: (attachment) => {
            localUri = attachment.local_uri!
            usersCollection.insert({
              id: randomUUID(),
              name: `steven`,
              email: `steven@journeyapps.com`,
              photo_id: attachment.id,
            })
            throw new Error(`updateHook failed`)
          },
        }),
      ).rejects.toThrow(/updateHook failed/)

      // The file is written before the transaction opens, so it must be cleaned up.
      expect(localUri).toBeDefined()
      expect(await localStorage.fileExists(localUri!)).toBe(false)

      // Neither the attachment nor the hook's own mutation may survive the failure.
      expect(attachmentsCollection.get(id)).toBeUndefined()
      expect(usersCollection.size).toBe(0)
    })
  })

  describe(`delete file`, () => {
    it.each([`eager`, `on-demand`] as const)(
      `can retry a failed save and later delete in %s mode`,
      async (syncMode) => {
        const fixture = await setup(syncMode)
        const first = fixture.createQueue()
        const options = {
          id: `retry`,
          data: createMockJpegBuffer(),
          fileExtension: `jpg`,
        }
        await expect(
          first.save({
            ...options,
            updateHook: () => {
              throw new Error(`hook failure`)
            },
          }),
        ).rejects.toThrow(`hook failure`)
        const second = fixture.createQueue()
        const saved = await second.save(options)
        expect(
          new Uint8Array(await fixture.localStorage.readFile(saved.local_uri!)),
        ).toEqual(new Uint8Array(createMockJpegBuffer()))
        await first.delete({ id: saved.id })
        expect(
          await fixture.db.get(`SELECT state FROM attachments WHERE id = ?`, [
            saved.id,
          ]),
        ).toEqual({ state: AttachmentState.QUEUED_DELETE })
      },
    )

    it(`finds a queued file after its storage root moves`, async () => {
      const fixture = await setup()
      const original = await fixture.createQueue().save({
        id: `moving`,
        data: createMockJpegBuffer(),
        fileExtension: `jpg`,
      })
      const moved = new NodeFileSystemAdapter(
        join(tmpdir(), `ps-moved-${randomUUID()}`),
      )
      await moved.initialize()
      onTestFinished(() => moved.clear())
      // Move the bytes without changing SQLite, as a changed app directory does.
      const movedUri = moved.getLocalUri(original.local_uri!.split(`/`).at(-1)!)
      await moved.saveFile(
        movedUri,
        await fixture.localStorage.readFile(original.local_uri!),
      )
      await fixture.localStorage.deleteFile(original.local_uri!)
      const queue = new TanStackDBAttachmentQueue({
        db: fixture.db,
        attachmentsCollection: fixture.attachmentsCollection,
        localStorage: moved,
        remoteStorage: fixture.remoteStorage,
        watchAttachments: () => {},
      })
      onTestFinished(() => queue.stopSync())
      await queue.startSync()
      await vi.waitFor(() =>
        expect(fixture.uploadFile).toHaveBeenCalledTimes(1),
      )
      expect(fixture.uploadFile.mock.calls[0]![1].localUri).toBe(movedUri)
      expect(new Uint8Array(await moved.readFile(movedUri))).toEqual(
        new Uint8Array(createMockJpegBuffer()),
      )
    })

    it.each([`eager`, `on-demand`] as const)(
      `loads an uncached attachment before deleting in %s mode`,
      async (syncMode) => {
        const fixture = await setup()
        const original = await fixture.createQueue().save({
          id: `uncached`,
          data: createMockJpegBuffer(),
          fileExtension: `jpg`,
        })
        const collection = createCollection(
          powerSyncCollectionOptions({
            database: fixture.db,
            table: APP_SCHEMA.props.attachments,
            syncMode,
          }),
        )
        onTestFinished(() => collection.cleanup())
        const queue = new TanStackDBAttachmentQueue({
          db: fixture.db,
          attachmentsCollection: collection,
          localStorage: fixture.localStorage,
          remoteStorage: fixture.remoteStorage,
          watchAttachments: () => {},
        })
        onTestFinished(() => queue.stopSync())
        expect(collection.get(original.id)).toBeUndefined()
        await queue.delete({ id: original.id })
        expect(
          await fixture.db.get(`SELECT state FROM attachments WHERE id = ?`, [
            original.id,
          ]),
        ).toEqual({ state: AttachmentState.QUEUED_DELETE })
      },
    )

    it(`queues an existing attachment for deletion and removes the local file`, async () => {
      const {
        createQueue,
        attachmentsCollection,
        usersCollection,
        localStorage,
      } = await setup()
      const queue = createQueue()
      await queue.startSync()

      const userId = randomUUID()
      const record = await queue.save({
        data: createMockJpegBuffer(),
        fileExtension: `jpg`,
        updateHook: (attachment) => {
          usersCollection.insert({
            id: userId,
            name: `steven`,
            email: `steven@journeyapps.com`,
            photo_id: attachment.id,
          })
        },
      })

      await waitForState(
        attachmentsCollection,
        record.id,
        AttachmentState.SYNCED,
      )

      await queue.delete({
        id: record.id,
        updateHook: (attachment) => {
          usersCollection.update(userId, (draft) => {
            if (draft.photo_id === attachment.id) {
              draft.photo_id = null
            }
          })
        },
      })

      // It should immediately be marked for deletion (and no longer synced).
      const queued = attachmentsCollection.get(record.id)
      expect(queued?.state).toBe(AttachmentState.QUEUED_DELETE)
      expect(queued?.has_synced).toBe(0)

      // The user reference should have been cleared in the same transaction.
      expect(usersCollection.get(userId)?.photo_id).toBeNull()

      // Eventually the row and the local file are removed.
      await vi.waitFor(
        () => expect(attachmentsCollection.get(record.id)).toBeUndefined(),
        { timeout: WAIT_TIMEOUT, interval: 50 },
      )
      expect(await localStorage.fileExists(record.local_uri!)).toBe(false)
    })

    it(`throws for an unknown id and commits nothing`, async () => {
      const { createQueue, attachmentsCollection, usersCollection } =
        await setup()
      const queue = createQueue()

      const hook = vi.fn()
      await expect(
        queue.delete({ id: `does-not-exist`, updateHook: hook }),
      ).rejects.toThrow(/not found/i)

      // The failing transaction must not have run the hook or touched state.
      expect(hook).not.toHaveBeenCalled()
      expect(attachmentsCollection.get(`does-not-exist`)).toBeUndefined()
      expect(usersCollection.size).toBe(0)
    })

    it(`rolls back the queued deletion when the updateHook throws`, async () => {
      const {
        createQueue,
        attachmentsCollection,
        usersCollection,
        localStorage,
      } = await setup()
      const queue = createQueue()

      const userId = randomUUID()
      const record = await queue.save({
        data: createMockJpegBuffer(),
        fileExtension: `jpg`,
        updateHook: (attachment) => {
          usersCollection.insert({
            id: userId,
            name: `steven`,
            email: `steven@journeyapps.com`,
            photo_id: attachment.id,
          })
        },
      })

      // Sync is deliberately left stopped: the rollback happens entirely in the
      // foreground transaction, and a running sync loop would only race teardown.
      await waitForState(
        attachmentsCollection,
        record.id,
        AttachmentState.QUEUED_UPLOAD,
      )

      await expect(
        queue.delete({
          id: record.id,
          updateHook: () => {
            usersCollection.update(userId, (draft) => {
              draft.photo_id = null
            })
            throw new Error(`updateHook failed`)
          },
        }),
      ).rejects.toThrow(/updateHook failed/)

      // Both the QUEUED_DELETE transition and the hook's mutation must be rolled back,
      // leaving the attachment intact rather than half-deleted.
      expect(attachmentsCollection.get(record.id)?.state).toBe(
        AttachmentState.QUEUED_UPLOAD,
      )
      expect(usersCollection.get(userId)?.photo_id).toBe(record.id)
      expect(await localStorage.fileExists(record.local_uri!)).toBe(true)
    })
  })
})
