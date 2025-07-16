import { BaseIndex, IndexOperation } from "./base-index.js";
import { ascComparator } from "../utils/comparison.js";
import { findInsertPosition } from "../utils/array-utils.js";
/**
 * Ordered index for sorted data with range queries
 * This maintains items in sorted order and provides efficient range operations
 */
export class OrderedIndex extends BaseIndex {
    constructor() {
        super(...arguments);
        this.supportedOperations = new Set([
            IndexOperation.EQ,
            IndexOperation.GT,
            IndexOperation.GTE,
            IndexOperation.LT,
            IndexOperation.LTE,
            IndexOperation.IN
        ]);
        // Internal data structures - private to hide implementation details
        this.orderedEntries = [];
        this.valueMap = new Map();
        this.indexedKeys = new Set();
        this.compareFn = ascComparator;
    }
    initialize(options) {
        this.compareFn = options?.compareFn ?? ascComparator;
    }
    /**
     * Adds a value to the index
     */
    add(key, item) {
        try {
            const indexedValue = this.evaluateIndexExpression(item);
            // Check if this value already exists
            if (this.valueMap.has(indexedValue)) {
                // Add to existing set
                this.valueMap.get(indexedValue).add(key);
            }
            else {
                // Create new set for this value
                const keySet = new Set([key]);
                this.valueMap.set(indexedValue, keySet);
                // Find correct position in ordered entries using binary search
                const insertIndex = findInsertPosition(this.orderedEntries, indexedValue, this.compareFn);
                this.orderedEntries.splice(insertIndex, 0, [indexedValue, keySet]);
            }
            this.indexedKeys.add(key);
            this.updateTimestamp();
        }
        catch (error) {
            // Silently skip if evaluation fails
        }
    }
    /**
     * Removes a value from the index
     */
    remove(key, item) {
        try {
            const indexedValue = this.evaluateIndexExpression(item);
            if (this.valueMap.has(indexedValue)) {
                const keySet = this.valueMap.get(indexedValue);
                keySet.delete(key);
                // If set is now empty, remove the entry entirely
                if (keySet.size === 0) {
                    this.valueMap.delete(indexedValue);
                    // Find and remove from ordered entries
                    const index = this.orderedEntries.findIndex(([value]) => this.compareFn(value, indexedValue) === 0);
                    if (index !== -1) {
                        this.orderedEntries.splice(index, 1);
                    }
                }
            }
            this.indexedKeys.delete(key);
            this.updateTimestamp();
        }
        catch (error) {
            // Silently skip if evaluation fails
        }
    }
    /**
     * Updates a value in the index
     */
    update(key, oldItem, newItem) {
        this.remove(key, oldItem);
        this.add(key, newItem);
    }
    /**
     * Builds the index from a collection of entries
     */
    build(entries) {
        this.clear();
        for (const [key, item] of entries) {
            this.add(key, item);
        }
    }
    /**
     * Clears all data from the index
     */
    clear() {
        this.orderedEntries = [];
        this.valueMap.clear();
        this.indexedKeys.clear();
        this.updateTimestamp();
    }
    /**
     * Performs a lookup operation
     */
    lookup(operation, value) {
        const startTime = performance.now();
        let result;
        switch (operation) {
            case IndexOperation.EQ:
                result = this.equalityLookup(value);
                break;
            case IndexOperation.GT:
            case IndexOperation.GTE:
            case IndexOperation.LT:
            case IndexOperation.LTE:
                result = this.rangeQuery(operation, value);
                break;
            case IndexOperation.IN:
                result = this.inArrayLookup(value);
                break;
            default:
                throw new Error(`Operation ${operation} not supported by OrderedIndex`);
        }
        this.trackLookup(startTime);
        return result;
    }
    /**
     * Gets the number of indexed keys
     */
    get keyCount() {
        return this.indexedKeys.size;
    }
    // Public methods for backward compatibility (used by tests)
    /**
     * Performs an equality lookup
     */
    equalityLookup(value) {
        return new Set(this.valueMap.get(value) ?? []);
    }
    /**
     * Performs a range query
     */
    rangeQuery(operation, value) {
        const result = new Set();
        // Use binary search to find the starting position
        const insertIndex = findInsertPosition(this.orderedEntries, value, this.compareFn);
        let startIndex = 0;
        let endIndex = this.orderedEntries.length;
        switch (operation) {
            case `lt`:
                endIndex = insertIndex;
                break;
            case `lte`:
                endIndex = insertIndex;
                // Include the value if it exists
                if (insertIndex < this.orderedEntries.length &&
                    this.compareFn(this.orderedEntries[insertIndex][0], value) === 0) {
                    endIndex = insertIndex + 1;
                }
                break;
            case `gt`:
                startIndex = insertIndex;
                // Skip the value if it exists
                if (insertIndex < this.orderedEntries.length &&
                    this.compareFn(this.orderedEntries[insertIndex][0], value) === 0) {
                    startIndex = insertIndex + 1;
                }
                endIndex = this.orderedEntries.length;
                break;
            case `gte`:
                startIndex = insertIndex;
                endIndex = this.orderedEntries.length;
                break;
        }
        // Collect keys from the range
        for (let i = startIndex; i < endIndex; i++) {
            const keys = this.orderedEntries[i][1];
            keys.forEach((key) => result.add(key));
        }
        return result;
    }
    /**
     * Performs an IN array lookup
     */
    inArrayLookup(values) {
        const result = new Set();
        for (const value of values) {
            const keys = this.valueMap.get(value);
            if (keys) {
                keys.forEach((key) => result.add(key));
            }
        }
        return result;
    }
    // Getter methods for testing compatibility
    get indexedKeysSet() {
        return this.indexedKeys;
    }
    get orderedEntriesArray() {
        return this.orderedEntries;
    }
    get valueMapData() {
        return this.valueMap;
    }
    estimateMemoryUsage() {
        // More accurate estimation for ordered index
        const entriesSize = this.orderedEntries.length * 100; // Estimated size per entry
        const valueMapSize = this.valueMap.size * 80; // Estimated size per map entry
        const indexedKeysSize = this.indexedKeys.size * 20; // Estimated size per key
        return entriesSize + valueMapSize + indexedKeysSize;
    }
}
