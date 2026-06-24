import {
  AttachmentQueue,
  AttachmentState
} from '@powersync/common'
import { createTransaction } from '@tanstack/db'
import { PowerSyncTransactor } from './PowerSyncTransactor'

import type {
  AbstractPowerSyncDatabase,
  AttachmentData,
  AttachmentQueueOptions,

  AttachmentTable} from '@powersync/common'
import type { Collection } from '@tanstack/db'
import type { OptionalExtractedTable } from './helpers'

export type TanStackDBAttachmentQueueOptions = AttachmentQueueOptions & {
  /**
   * For TanStack, we want access to the synced TanStackDB collection.
   * In order to have the same relational data be set in a single transaction.
   * This also allows for joining both TanStackDB collections.
   */
  attachmentsCollection: Collection<AttachmentQueueRow, string>
}

export interface SaveOptions {
  data: AttachmentData
  fileExtension: string
  mediaType?: string
  metaData?: string
  id?: string
  /**
   * Called within the same TanStackDB transaction as the attachment write,
   * so any mutations made to other collections are committed atomically with it.
   */
  updateHook?: (attachment: AttachmentQueueRow) => void
}

export interface DeleteOptions {
  id: string
  /**
   * Called within the same TanStackDB transaction as the attachment write,
   * so any mutations made to other collections are committed atomically with it.
   */
  updateHook?: (attachment: AttachmentQueueRow) => void
}

export type AttachmentQueueRow = OptionalExtractedTable<AttachmentTable>

/**
 * A custom extension of the PowerSyncAttachmentQueue for TanStackDB.
 */
export class TanStackDBAttachmentQueue extends AttachmentQueue {
  readonly powersync: AbstractPowerSyncDatabase
  readonly collection: Collection<AttachmentQueueRow, string>

  constructor(params: TanStackDBAttachmentQueueOptions) {
    super(params)
    this.powersync = params.db
    this.collection = params.attachmentsCollection
  }

  /**
   * Saves a file to local storage and queues it for upload to remote storage.
   *
   * Exposes an `updateHook` option which is called inside a TanStackDB transaction,
   * relational associations with the provided attachment ID should be made in this hook.
   */
  async save({
    data,
    fileExtension,
    mediaType,
    metaData,
    id,
    updateHook,
  }: SaveOptions): Promise<AttachmentQueueRow> {
    const resolvedId = id ?? (await this.generateAttachmentId())
    const filename = `${resolvedId}.${fileExtension}`
    const localUri = this.localStorage.getLocalUri(filename)
    const size = await this.localStorage.saveFile(localUri, data)

    const attachment: AttachmentQueueRow = {
      id: resolvedId,
      filename,
      media_type: mediaType ?? null,
      local_uri: localUri,
      state: AttachmentState.QUEUED_UPLOAD,
      has_synced: 0,
      size,
      timestamp: new Date().getTime(),
      meta_data: metaData ?? null,
    }

    /**
     * We use the attachmentService lock to prevent attachment queue race conditions — specifically,
     * it stops the watcher from treating a newly inserted attachment record as one that needs
     * to be downloaded.
     * */
    await this.withAttachmentContext(async (ctx) => {
      const tanStackDBTransaction = createTransaction({
        autoCommit: false,
        mutationFn: async ({ transaction }) => {
          await new PowerSyncTransactor({
            database: ctx.db,
          }).applyTransaction(transaction)
        },
      })

      tanStackDBTransaction.mutate(() => {
        this.collection.insert(attachment)
        // allow the user to associate values in this transaction
        updateHook?.(attachment)
      })

      await tanStackDBTransaction.commit()
    })

    return attachment
  }

  /**
   * Queues a file for deletion from local and remote storage.
   *
   * Exposes an `updateHook` option which is called inside a TanStackDB transaction,
   * relational associations with the provided attachment ID should be cleaned up in this hook.
   */
  async delete({ id, updateHook }: DeleteOptions): Promise<void> {
    await this.withAttachmentContext(async (ctx) => {
      const tanStackDBTransaction = createTransaction({
        autoCommit: false,
        mutationFn: async ({ transaction }) => {
          await new PowerSyncTransactor({
            database: ctx.db,
          }).applyTransaction(transaction)
        },
      })

      tanStackDBTransaction.mutate(() => {
        const attachment = this.collection.get(id)
        if (!attachment) {
          throw new Error(`Attachment with id ${id} not found`)
        }

        this.collection.update(id, (draft) => {
          draft.state = AttachmentState.QUEUED_DELETE
          draft.has_synced = 0
        })

        // allow the user to associate values in this transaction
        updateHook?.(attachment)
      })

      await tanStackDBTransaction.commit()
    })
  }
}
