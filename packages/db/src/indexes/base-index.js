import { compileSingleRowExpression } from "../query/compiler/evaluators.js";
/**
 * Operations that indexes can support
 */
export var IndexOperation;
(function (IndexOperation) {
    // Basic comparisons
    IndexOperation["EQ"] = "eq";
    IndexOperation["NE"] = "ne";
    IndexOperation["GT"] = "gt";
    IndexOperation["GTE"] = "gte";
    IndexOperation["LT"] = "lt";
    IndexOperation["LTE"] = "lte";
    // Array/set operations
    IndexOperation["IN"] = "in";
    IndexOperation["NOT_IN"] = "not_in";
    // Text operations
    IndexOperation["LIKE"] = "like";
    IndexOperation["ILIKE"] = "ilike";
    IndexOperation["MATCH"] = "match";
    IndexOperation["SIMILAR"] = "similar";
    // Fuzzy operations
    IndexOperation["FUZZY"] = "fuzzy";
    IndexOperation["DISTANCE"] = "distance";
    // Geometric operations (future)
    IndexOperation["CONTAINS"] = "contains";
    IndexOperation["WITHIN"] = "within";
})(IndexOperation || (IndexOperation = {}));
/**
 * Base abstract class that all index types extend
 */
export class BaseIndex {
    constructor(id, expression, name, options) {
        this.lookupCount = 0;
        this.totalLookupTime = 0;
        this.lastUpdated = new Date();
        this.id = id;
        this.expression = expression;
        this.name = name;
        this.initialize(options);
    }
    // Common methods
    supports(operation) {
        return this.supportedOperations.has(operation);
    }
    matchesField(fieldPath) {
        return (this.expression.type === `ref` &&
            this.expression.path.length === fieldPath.length &&
            this.expression.path.every((part, i) => part === fieldPath[i]));
    }
    getStats() {
        return {
            entryCount: this.keyCount,
            memoryUsage: this.estimateMemoryUsage(),
            lookupCount: this.lookupCount,
            averageLookupTime: this.lookupCount > 0 ? this.totalLookupTime / this.lookupCount : 0,
            lastUpdated: this.lastUpdated
        };
    }
    evaluateIndexExpression(item) {
        const evaluator = compileSingleRowExpression(this.expression);
        return evaluator(item);
    }
    trackLookup(startTime) {
        const duration = performance.now() - startTime;
        this.lookupCount++;
        this.totalLookupTime += duration;
    }
    estimateMemoryUsage() {
        // Basic estimation - subclasses can override for more accurate estimates
        return this.keyCount * 50; // Rough estimate: 50 bytes per entry
    }
    updateTimestamp() {
        this.lastUpdated = new Date();
    }
}
