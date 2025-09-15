import type { Collection } from "@tanstack/db"
import type { OfflineTransaction } from "../types"

export class TransactionReplay {
  private collections: Record<string, Collection>

  constructor(collections: Record<string, Collection>) {
    this.collections = collections
  }

  async replayAll(transactions: Array<OfflineTransaction>): Promise<void> {
    const sortedTransactions = transactions.sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
    )

    for (const transaction of sortedTransactions) {
      await this.replayTransaction(transaction)
    }
  }

  private async replayTransaction(
    transaction: OfflineTransaction
  ): Promise<void> {
    const mutationsByCollection = this.groupMutationsByCollection(transaction)

    for (const [collectionId, mutations] of mutationsByCollection) {
      const collection = this.collections[collectionId]

      if (!collection) {
        console.warn(`Collection ${collectionId} not found for replay`)
        continue
      }

      for (const mutation of mutations) {
        await this.replayMutation(collection, mutation)
      }
    }
  }

  private groupMutationsByCollection(
    transaction: OfflineTransaction
  ): Map<string, Array<any>> {
    const groups = new Map<string, Array<any>>()

    for (const mutation of transaction.mutations) {
      const collectionId = (mutation as any).collectionId

      if (!groups.has(collectionId)) {
        groups.set(collectionId, [])
      }

      groups.get(collectionId)!.push(mutation)
    }

    return groups
  }

  private async replayMutation(
    collection: Collection,
    mutation: any
  ): Promise<void> {
    try {
      switch (mutation.type) {
        case `insert`:
          if (mutation.modified) {
            await collection.insert(mutation.modified)
          }
          break

        case `update`:
          if (mutation.modified && mutation.globalKey) {
            const id = this.extractIdFromGlobalKey(mutation.globalKey)
            await collection.update(id, () => mutation.modified)
          }
          break

        case `delete`:
          if (mutation.globalKey) {
            const id = this.extractIdFromGlobalKey(mutation.globalKey)
            await collection.delete(id)
          }
          break

        default:
          console.warn(`Unknown mutation type: ${mutation.type}`)
      }
    } catch (error) {
      console.warn(
        `Failed to replay mutation for collection ${collection.id}:`,
        error
      )
    }
  }

  private extractIdFromGlobalKey(globalKey: string): string {
    const parts = globalKey.split(`:`)
    return parts[parts.length - 1] || ``
  }
}
