// Ambient declaration to provide the global devtools type for the db package
// This avoids depending on the db-devtools package while allowing typed access

export {}

declare global {
  interface Window {
    // Minimal subset needed by the core db package
    __TANSTACK_DB_DEVTOOLS__?: {
      registerCollection?: (collection: any) => (() => void) | undefined
      unregisterCollection?: (id: string) => void
      registerTransaction?: (transaction: any, collectionId: string) => void
      updateTransactions?: (collectionId?: string) => void
      store?: {
        registerTransaction?: (transaction: any, collectionId: string) => void
      }
    }

    // Queue used before devtools initialize (read/written by core)
    __TANSTACK_DB_PENDING_TRANSACTIONS__?: Array<{
      transaction: any
      collectionId: string
    }>
  }
}
