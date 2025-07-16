import { BaseIndex, IndexOperation } from "./base-index.js";
/**
 * Placeholder FullText index for text search (not yet implemented)
 */
export class FullTextIndex extends BaseIndex {
    constructor() {
        super(...arguments);
        this.supportedOperations = new Set([
            IndexOperation.EQ,
        ]);
    }
    initialize() {
        // Placeholder implementation
    }
    add(key, item) {
        // TODO: Implement full text indexing
    }
    remove(key, item) {
        // TODO: Implement full text removal
    }
    update(key, oldItem, newItem) {
        this.remove(key, oldItem);
        this.add(key, newItem);
    }
    build(entries) {
        this.clear();
        for (const [key, item] of entries) {
            this.add(key, item);
        }
    }
    clear() {
        this.updateTimestamp();
    }
    lookup(operation, value) {
        // TODO: Implement full text search
        return new Set();
    }
    get keyCount() {
        return 0;
    }
    estimateMemoryUsage() {
        return 0;
    }
}
