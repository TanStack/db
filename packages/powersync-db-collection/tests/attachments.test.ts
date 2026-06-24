import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  async function setup() {
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
      expect(await localStorage.fileExists(record.local_uri)).toBe(true)

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
        updateHook: async (attachment) => {
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
        updateHook: async (attachment) => {
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
  })

  describe(`delete file`, () => {
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
        updateHook: async (attachment) => {
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
        updateHook: async (attachment) => {
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
      expect(await localStorage.fileExists(record.local_uri)).toBe(false)
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
  })
})
