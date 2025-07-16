import { D2, MultiSet, output } from "@electric-sql/d2mini";
import { createCollection } from "../collection.js";
import { compileQuery } from "./compiler/index.js";
import { buildQuery, getQueryIR } from "./builder/index.js";
// Global counter for auto-generated collection IDs
let liveQueryCollectionCounter = 0;
/**
 * Creates live query collection options for use with createCollection
 *
 * @example
 * ```typescript
 * const options = liveQueryCollectionOptions({
 *   // id is optional - will auto-generate if not provided
 *   query: (q) => q
 *     .from({ post: postsCollection })
 *     .where(({ post }) => eq(post.published, true))
 *     .select(({ post }) => ({
 *       id: post.id,
 *       title: post.title,
 *       content: post.content,
 *     })),
 *   // getKey is optional - will use stream key if not provided
 * })
 *
 * const collection = createCollection(options)
 * ```
 *
 * @param config - Configuration options for the live query collection
 * @returns Collection options that can be passed to createCollection
 */
export function liveQueryCollectionOptions(config) {
    // Generate a unique ID if not provided
    const id = config.id || `live-query-${++liveQueryCollectionCounter}`;
    // Build the query using the provided query builder function or instance
    const query = typeof config.query === `function`
        ? buildQuery(config.query)
        : getQueryIR(config.query);
    // WeakMap to store the keys of the results so that we can retreve them in the
    // getKey function
    const resultKeys = new WeakMap();
    // WeakMap to store the orderBy index for each result
    const orderByIndices = new WeakMap();
    // Create compare function for ordering if the query has orderBy
    const compare = query.orderBy && query.orderBy.length > 0
        ? (val1, val2) => {
            // Use the orderBy index stored in the WeakMap
            const index1 = orderByIndices.get(val1);
            const index2 = orderByIndices.get(val2);
            // Compare fractional indices lexicographically
            if (index1 && index2) {
                if (index1 < index2) {
                    return -1;
                }
                else if (index1 > index2) {
                    return 1;
                }
                else {
                    return 0;
                }
            }
            // Fallback to no ordering if indices are missing
            return 0;
        }
        : undefined;
    const collections = extractCollectionsFromQuery(query);
    const allCollectionsReady = () => {
        return Object.values(collections).every((collection) => collection.status === `ready` || collection.status === `initialCommit`);
    };
    let graphCache;
    let inputsCache;
    let pipelineCache;
    const compileBasePipeline = () => {
        graphCache = new D2();
        inputsCache = Object.fromEntries(Object.entries(collections).map(([key]) => [
            key,
            graphCache.newInput(),
        ]));
        pipelineCache = compileQuery(query, inputsCache);
    };
    const maybeCompileBasePipeline = () => {
        if (!graphCache || !inputsCache || !pipelineCache) {
            compileBasePipeline();
        }
        return {
            graph: graphCache,
            inputs: inputsCache,
            pipeline: pipelineCache,
        };
    };
    // Compile the base pipeline once initially
    // This is done to ensure that any errors are thrown immediately and synchronously
    compileBasePipeline();
    // Create the sync configuration
    const sync = {
        rowUpdateMode: `full`,
        sync: ({ begin, write, commit, collection: theCollection }) => {
            const { graph, inputs, pipeline } = maybeCompileBasePipeline();
            let messagesCount = 0;
            pipeline.pipe(output((data) => {
                const messages = data.getInner();
                messagesCount += messages.length;
                begin();
                messages
                    .reduce((acc, [[key, tupleData], multiplicity]) => {
                    // All queries now consistently return [value, orderByIndex] format
                    // where orderByIndex is undefined for queries without ORDER BY
                    const [value, orderByIndex] = tupleData;
                    const changes = acc.get(key) || {
                        deletes: 0,
                        inserts: 0,
                        value,
                        orderByIndex,
                    };
                    if (multiplicity < 0) {
                        changes.deletes += Math.abs(multiplicity);
                    }
                    else if (multiplicity > 0) {
                        changes.inserts += multiplicity;
                        changes.value = value;
                        changes.orderByIndex = orderByIndex;
                    }
                    acc.set(key, changes);
                    return acc;
                }, new Map())
                    .forEach((changes, rawKey) => {
                    const { deletes, inserts, value, orderByIndex } = changes;
                    // Store the key of the result so that we can retrieve it in the
                    // getKey function
                    resultKeys.set(value, rawKey);
                    // Store the orderBy index if it exists
                    if (orderByIndex !== undefined) {
                        orderByIndices.set(value, orderByIndex);
                    }
                    // Simple singular insert.
                    if (inserts && deletes === 0) {
                        write({
                            value,
                            type: `insert`,
                        });
                    }
                    else if (
                    // Insert & update(s) (updates are a delete & insert)
                    inserts > deletes ||
                        // Just update(s) but the item is already in the collection (so
                        // was inserted previously).
                        (inserts === deletes &&
                            theCollection.has(rawKey))) {
                        write({
                            value,
                            type: `update`,
                        });
                        // Only delete is left as an option
                    }
                    else if (deletes > 0) {
                        write({
                            value,
                            type: `delete`,
                        });
                    }
                    else {
                        throw new Error(`This should never happen ${JSON.stringify(changes)}`);
                    }
                });
                commit();
            }));
            graph.finalize();
            const maybeRunGraph = () => {
                // We only run the graph if all the collections are ready
                if (allCollectionsReady()) {
                    graph.run();
                    // On the initial run, we may need to do an empty commit to ensure that
                    // the collection is initialized
                    if (messagesCount === 0) {
                        begin();
                        commit();
                    }
                }
            };
            // Unsubscribe callbacks
            const unsubscribeCallbacks = new Set();
            // Set up data flow from input collections to the compiled query
            Object.entries(collections).forEach(([collectionId, collection]) => {
                const input = inputs[collectionId];
                // Subscribe to changes
                const unsubscribe = collection.subscribeChanges((changes) => {
                    sendChangesToInput(input, changes, collection.config.getKey);
                    maybeRunGraph();
                }, { includeInitialState: true });
                unsubscribeCallbacks.add(unsubscribe);
            });
            // Initial run
            maybeRunGraph();
            // Return the unsubscribe function
            return () => {
                unsubscribeCallbacks.forEach((unsubscribe) => unsubscribe());
            };
        },
    };
    // Return collection configuration
    return {
        id,
        getKey: config.getKey || ((item) => resultKeys.get(item)),
        sync,
        compare,
        gcTime: config.gcTime || 5000, // 5 seconds by default for live queries
        schema: config.schema,
        onInsert: config.onInsert,
        onUpdate: config.onUpdate,
        onDelete: config.onDelete,
        startSync: config.startSync,
    };
}
// Implementation
export function createLiveQueryCollection(configOrQuery) {
    // Determine if the argument is a function (query) or a config object
    if (typeof configOrQuery === `function`) {
        // Simple query function case
        const config = {
            query: configOrQuery,
        };
        const options = liveQueryCollectionOptions(config);
        return bridgeToCreateCollection(options);
    }
    else {
        // Config object case
        const config = configOrQuery;
        const options = liveQueryCollectionOptions(config);
        return bridgeToCreateCollection({
            ...options,
            utils: config.utils,
        });
    }
}
/**
 * Bridge function that handles the type compatibility between query2's TResult
 * and core collection's ResolveType without exposing ugly type assertions to users
 */
function bridgeToCreateCollection(options) {
    // This is the only place we need a type assertion, hidden from user API
    return createCollection(options);
}
/**
 * Helper function to send changes to a D2 input stream
 */
function sendChangesToInput(input, changes, getKey) {
    const multiSetArray = [];
    for (const change of changes) {
        const key = getKey(change.value);
        if (change.type === `insert`) {
            multiSetArray.push([[key, change.value], 1]);
        }
        else if (change.type === `update`) {
            multiSetArray.push([[key, change.previousValue], -1]);
            multiSetArray.push([[key, change.value], 1]);
        }
        else {
            // change.type === `delete`
            multiSetArray.push([[key, change.value], -1]);
        }
    }
    input.sendData(new MultiSet(multiSetArray));
}
/**
 * Helper function to extract collections from a compiled query
 * Traverses the query IR to find all collection references
 * Maps collections by their ID (not alias) as expected by the compiler
 */
function extractCollectionsFromQuery(query) {
    const collections = {};
    // Helper function to recursively extract collections from a query or source
    function extractFromSource(source) {
        if (source.type === `collectionRef`) {
            collections[source.collection.id] = source.collection;
        }
        else if (source.type === `queryRef`) {
            // Recursively extract from subquery
            extractFromQuery(source.query);
        }
    }
    // Helper function to recursively extract collections from a query
    function extractFromQuery(q) {
        // Extract from FROM clause
        if (q.from) {
            extractFromSource(q.from);
        }
        // Extract from JOIN clauses
        if (q.join && Array.isArray(q.join)) {
            for (const joinClause of q.join) {
                if (joinClause.from) {
                    extractFromSource(joinClause.from);
                }
            }
        }
    }
    // Start extraction from the root query
    extractFromQuery(query);
    return collections;
}
