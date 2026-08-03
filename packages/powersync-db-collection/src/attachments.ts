import { AttachmentQueue, AttachmentState } from '@powersync/common'
import { createTransaction } from '@tanstack/db'
import { PowerSyncTransactor } from './PowerSyncTransactor'

import type {
  AbstractPowerSyncDatabase,
  AttachmentData,
  AttachmentQueueOptions,
  AttachmentTable,
} from '@powersync/common'
import type { Collection, Transaction } from '@tanstack/db'
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
  /**
   * Optional custom ID. If not provided, a UUID will be generated.
   *
   * Rejected if an attachment with this ID is already in the queue.
   */
  id?: string
  /**
   * Called synchronously within the same TanStackDB transaction as the attachment write,
   * so any mutations made to other collections are committed atomically with it.
   *
   * Must not be async. `Transaction.mutate` unregisters the ambient transaction as soon as
   * this callback returns, so any mutation made after an `await` inside the hook escapes the
   * transaction and is not committed atomically with the attachment. Do asynchronous work
   * before calling `save` or `delete`.
   */
  updateHook?: (attachment: AttachmentQueueRow) => void
}

export interface DeleteOptions {
  id: string
  /**
   * Called synchronously within the same TanStackDB transaction as the attachment write,
   * so any mutations made to other collections are committed atomically with it.
   *
   * Must not be async. `Transaction.mutate` unregisters the ambient transaction as soon as
   * this callback returns, so any mutation made after an `await` inside the hook escapes the
   * transaction and is not committed atomically with the attachment. Do asynchronous work
   * before calling `save` or `delete`.
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

    /**
     * Checked before the file is written. Writing first would overwrite the existing
     * attachment's local file, and the cleanup below would then delete it — leaving the
     * pre-existing record pointing at a file that no longer exists.
     */
    if (this.collection.get(resolvedId)) {
      throw new Error(`Attachment with id ${resolvedId} already exists`)
    }

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

    try {
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

        await this.runInTransaction(tanStackDBTransaction, () => {
          this.collection.insert(attachment)
          // allow the user to associate values in this transaction
          updateHook?.(attachment)
        })
      })
    } catch (error) {
      /**
       * The file is written before the transaction opens, so a failed transaction would
       * otherwise leave an orphaned file behind that no attachment record points to.
       */
      await this.deleteLocalFile(localUri)
      throw error
    }

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

      await this.runInTransaction(tanStackDBTransaction, () => {
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
    })
  }

  /**
   * Applies `mutations` to `transaction` and commits it, rolling back on any failure.
   *
   * `Transaction.mutate` does not roll back when its callback throws, so a throwing
   * `updateHook` would otherwise leave the transaction pending with its optimistic
   * mutations still applied to the collections.
   */
  protected async runInTransaction(
    transaction: Transaction,
    mutations: () => void,
  ): Promise<void> {
    /**
     * `rollback` rejects this promise. The error is already surfaced to the caller by the
     * throw below, so this catch only stops it from becoming an unhandled rejection.
     */
    void transaction.isPersisted.promise.catch(() => {})

    try {
      transaction.mutate(mutations)
    } catch (error) {
      transaction.rollback()
      throw error
    }

    await transaction.commit()
  }

  /**
   * Best-effort removal of a local file. A cleanup failure is logged rather than thrown,
   * so that it can never mask the error which triggered the cleanup.
   */
  protected async deleteLocalFile(localUri: string): Promise<void> {
    try {
      await this.localStorage.deleteFile(localUri)
    } catch (error) {
      this.logger.error(
        `Could not clean up local attachment file ${localUri}`,
        error,
      )
    }
  }
}
