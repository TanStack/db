/**
 * Creates Local-only collection options for use with a standard Collection
 *
 * This is an in-memory collection that doesn't sync with external sources but uses a loopback sync config
 * that immediately "syncs" all optimistic changes to the collection, making them permanent.
 * Perfect for local-only data that doesn't need persistence or external synchronization.
 *
 * @template TExplicit - The explicit type of items in the collection (highest priority)
 * @template TSchema - The schema type for validation and type inference (second priority)
 * @template TFallback - The fallback type if no explicit or schema type is provided
 * @template TKey - The type of the key returned by getKey
 * @param config - Configuration options for the Local-only collection
 * @returns Collection options with utilities (currently empty but follows the pattern)
 *
 * @example
 * // Basic local-only collection
 * const collection = createCollection(
 *   localOnlyCollectionOptions({
 *     getKey: (item) => item.id,
 *   })
 * )
 *
 * @example
 * // Local-only collection with initial data
 * const collection = createCollection(
 *   localOnlyCollectionOptions({
 *     getKey: (item) => item.id,
 *     initialData: [
 *       { id: 1, name: 'Item 1' },
 *       { id: 2, name: 'Item 2' },
 *     ],
 *   })
 * )
 *
 * @example
 * // Local-only collection with mutation handlers
 * const collection = createCollection(
 *   localOnlyCollectionOptions({
 *     getKey: (item) => item.id,
 *     onInsert: async ({ transaction }) => {
 *       console.log('Item inserted:', transaction.mutations[0].modified)
 *       // Custom logic after insert
 *     },
 *   })
 * )
 */
export function localOnlyCollectionOptions(config) {
    const { initialData, onInsert, onUpdate, onDelete, ...restConfig } = config;
    // Create the sync configuration with transaction confirmation capability
    const syncResult = createLocalOnlySync(initialData);
    /**
     * Create wrapper handlers that call user handlers first, then confirm transactions
     * Wraps the user's onInsert handler to also confirm the transaction immediately
     */
    const wrappedOnInsert = async (params) => {
        // Call user handler first if provided
        let handlerResult;
        if (onInsert) {
            handlerResult = (await onInsert(params)) ?? {};
        }
        // Then synchronously confirm the transaction by looping through mutations
        syncResult.confirmOperationsSync(params.transaction.mutations);
        return handlerResult;
    };
    /**
     * Wrapper for onUpdate handler that also confirms the transaction immediately
     */
    const wrappedOnUpdate = async (params) => {
        // Call user handler first if provided
        let handlerResult;
        if (onUpdate) {
            handlerResult = (await onUpdate(params)) ?? {};
        }
        // Then synchronously confirm the transaction by looping through mutations
        syncResult.confirmOperationsSync(params.transaction.mutations);
        return handlerResult;
    };
    /**
     * Wrapper for onDelete handler that also confirms the transaction immediately
     */
    const wrappedOnDelete = async (params) => {
        // Call user handler first if provided
        let handlerResult;
        if (onDelete) {
            handlerResult = (await onDelete(params)) ?? {};
        }
        // Then synchronously confirm the transaction by looping through mutations
        syncResult.confirmOperationsSync(params.transaction.mutations);
        return handlerResult;
    };
    return {
        ...restConfig,
        sync: syncResult.sync,
        onInsert: wrappedOnInsert,
        onUpdate: wrappedOnUpdate,
        onDelete: wrappedOnDelete,
        utils: {},
        startSync: true,
        gcTime: 0,
    };
}
/**
 * Internal function to create Local-only sync configuration with transaction confirmation
 *
 * This captures the sync functions and provides synchronous confirmation of operations.
 * It creates a loopback sync that immediately confirms all optimistic operations,
 * making them permanent in the collection.
 *
 * @param initialData - Optional array of initial items to populate the collection
 * @returns Object with sync configuration and confirmOperationsSync function
 */
function createLocalOnlySync(initialData) {
    // Capture sync functions for transaction confirmation
    let syncBegin = null;
    let syncWrite = null;
    let syncCommit = null;
    const sync = {
        /**
         * Sync function that captures sync parameters and applies initial data
         * @param params - Sync parameters containing begin, write, and commit functions
         * @returns Unsubscribe function (empty since no ongoing sync is needed)
         */
        sync: (params) => {
            const { begin, write, commit } = params;
            // Capture sync functions for later use by confirmOperationsSync
            syncBegin = begin;
            syncWrite = write;
            syncCommit = commit;
            // Apply initial data if provided
            if (initialData && initialData.length > 0) {
                begin();
                initialData.forEach((item) => {
                    write({
                        type: `insert`,
                        value: item,
                    });
                });
                commit();
            }
            // Return empty unsubscribe function - no ongoing sync needed
            return () => { };
        },
        /**
         * Get sync metadata - returns empty object for local-only collections
         * @returns Empty metadata object
         */
        getSyncMetadata: () => ({}),
    };
    /**
     * Synchronously confirms optimistic operations by immediately writing through sync
     *
     * This loops through transaction mutations and applies them to move from optimistic to synced state.
     * It's called after user handlers to make optimistic changes permanent.
     *
     * @param mutations - Array of mutation objects from the transaction
     */
    const confirmOperationsSync = (mutations) => {
        if (!syncBegin || !syncWrite || !syncCommit) {
            return; // Sync not initialized yet, which is fine
        }
        // Immediately write back through sync interface
        syncBegin();
        mutations.forEach((mutation) => {
            if (syncWrite) {
                syncWrite({
                    type: mutation.type,
                    value: mutation.modified,
                });
            }
        });
        syncCommit();
    };
    return {
        sync,
        confirmOperationsSync,
    };
}
