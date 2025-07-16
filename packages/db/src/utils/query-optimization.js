import { IndexOperation } from "../indexes/base-index.js";
/**
 * Finds an index that matches a given field path
 */
export function findIndexForField(indexes, fieldPath) {
    for (const index of indexes.values()) {
        if (index.matchesField(fieldPath)) {
            return index;
        }
    }
    return undefined;
}
/**
 * Intersects multiple sets (AND logic)
 */
export function intersectSets(sets) {
    if (sets.length === 0)
        return new Set();
    if (sets.length === 1)
        return new Set(sets[0]);
    let result = new Set(sets[0]);
    for (let i = 1; i < sets.length; i++) {
        const newResult = new Set();
        for (const item of result) {
            if (sets[i].has(item)) {
                newResult.add(item);
            }
        }
        result = newResult;
    }
    return result;
}
/**
 * Unions multiple sets (OR logic)
 */
export function unionSets(sets) {
    const result = new Set();
    for (const set of sets) {
        for (const item of set) {
            result.add(item);
        }
    }
    return result;
}
/**
 * Optimizes a query expression using available indexes
 */
export function optimizeQuery(expression, indexes) {
    return optimizeQueryRecursive(expression, indexes);
}
/**
 * Recursively optimizes query expressions
 */
function optimizeQueryRecursive(expression, indexes) {
    if (expression.type === `func`) {
        switch (expression.name) {
            case `eq`:
            case `gt`:
            case `gte`:
            case `lt`:
            case `lte`:
                return optimizeSimpleComparison(expression, indexes);
            case `and`:
                return optimizeAndExpression(expression, indexes);
            case `or`:
                return optimizeOrExpression(expression, indexes);
            case `in`:
                return optimizeInArrayExpression(expression, indexes);
        }
    }
    return { canOptimize: false, matchingKeys: new Set() };
}
/**
 * Checks if an expression can be optimized
 */
export function canOptimizeExpression(expression, indexes) {
    if (expression.type === `func`) {
        switch (expression.name) {
            case `eq`:
            case `gt`:
            case `gte`:
            case `lt`:
            case `lte`:
                return canOptimizeSimpleComparison(expression, indexes);
            case `and`:
                return canOptimizeAndExpression(expression, indexes);
            case `or`:
                return canOptimizeOrExpression(expression, indexes);
            case `in`:
                return canOptimizeInArrayExpression(expression, indexes);
        }
    }
    return false;
}
/**
 * Optimizes simple comparison expressions (eq, gt, gte, lt, lte)
 */
function optimizeSimpleComparison(expression, indexes) {
    if (expression.type !== `func` || expression.args.length !== 2) {
        return { canOptimize: false, matchingKeys: new Set() };
    }
    const leftArg = expression.args[0];
    const rightArg = expression.args[1];
    // Check both directions: field op value AND value op field
    let fieldArg = null;
    let valueArg = null;
    let operation = expression.name;
    if (leftArg.type === `ref` && rightArg.type === `val`) {
        // field op value
        fieldArg = leftArg;
        valueArg = rightArg;
    }
    else if (leftArg.type === `val` && rightArg.type === `ref`) {
        // value op field - need to flip the operation
        fieldArg = rightArg;
        valueArg = leftArg;
        // Flip the operation for reverse comparison
        switch (operation) {
            case `gt`:
                operation = `lt`;
                break;
            case `gte`:
                operation = `lte`;
                break;
            case `lt`:
                operation = `gt`;
                break;
            case `lte`:
                operation = `gte`;
                break;
            // eq stays the same
        }
    }
    if (fieldArg && valueArg) {
        const fieldPath = fieldArg.path;
        const index = findIndexForField(indexes, fieldPath);
        if (index) {
            const queryValue = valueArg.value;
            // Map operation to IndexOperation enum
            const indexOperation = operation;
            // Check if the index supports this operation
            if (!index.supports(indexOperation)) {
                return { canOptimize: false, matchingKeys: new Set() };
            }
            const matchingKeys = index.lookup(indexOperation, queryValue);
            return { canOptimize: true, matchingKeys };
        }
    }
    return { canOptimize: false, matchingKeys: new Set() };
}
/**
 * Checks if a simple comparison can be optimized
 */
function canOptimizeSimpleComparison(expression, indexes) {
    if (expression.type !== `func` || expression.args.length !== 2) {
        return false;
    }
    const leftArg = expression.args[0];
    const rightArg = expression.args[1];
    // Check both directions: field op value AND value op field
    let fieldPath = null;
    if (leftArg.type === `ref` && rightArg.type === `val`) {
        fieldPath = leftArg.path;
    }
    else if (leftArg.type === `val` && rightArg.type === `ref`) {
        fieldPath = rightArg.path;
    }
    if (fieldPath) {
        const index = findIndexForField(indexes, fieldPath);
        return index !== undefined;
    }
    return false;
}
/**
 * Optimizes AND expressions
 */
function optimizeAndExpression(expression, indexes) {
    if (expression.type !== `func` || expression.args.length < 2) {
        return { canOptimize: false, matchingKeys: new Set() };
    }
    const results = [];
    // Try to optimize each part, keep the optimizable ones
    for (const arg of expression.args) {
        const result = optimizeQueryRecursive(arg, indexes);
        if (result.canOptimize) {
            results.push(result);
        }
    }
    if (results.length > 0) {
        // Use intersectSets utility for AND logic
        const allMatchingSets = results.map((r) => r.matchingKeys);
        const intersectedKeys = intersectSets(allMatchingSets);
        return { canOptimize: true, matchingKeys: intersectedKeys };
    }
    return { canOptimize: false, matchingKeys: new Set() };
}
/**
 * Checks if an AND expression can be optimized
 */
function canOptimizeAndExpression(expression, indexes) {
    if (expression.type !== `func` || expression.args.length < 2) {
        return false;
    }
    // If any argument can be optimized, we can gain some speedup
    return expression.args.some((arg) => canOptimizeExpression(arg, indexes));
}
/**
 * Optimizes OR expressions
 */
function optimizeOrExpression(expression, indexes) {
    if (expression.type !== `func` || expression.args.length < 2) {
        return { canOptimize: false, matchingKeys: new Set() };
    }
    const results = [];
    // Try to optimize each part, keep the optimizable ones
    for (const arg of expression.args) {
        const result = optimizeQueryRecursive(arg, indexes);
        if (result.canOptimize) {
            results.push(result);
        }
    }
    if (results.length > 0) {
        // Use unionSets utility for OR logic
        const allMatchingSets = results.map((r) => r.matchingKeys);
        const unionedKeys = unionSets(allMatchingSets);
        return { canOptimize: true, matchingKeys: unionedKeys };
    }
    return { canOptimize: false, matchingKeys: new Set() };
}
/**
 * Checks if an OR expression can be optimized
 */
function canOptimizeOrExpression(expression, indexes) {
    if (expression.type !== `func` || expression.args.length < 2) {
        return false;
    }
    // If any argument can be optimized, we can gain some speedup
    return expression.args.some((arg) => canOptimizeExpression(arg, indexes));
}
/**
 * Optimizes IN array expressions
 */
function optimizeInArrayExpression(expression, indexes) {
    if (expression.type !== `func` || expression.args.length !== 2) {
        return { canOptimize: false, matchingKeys: new Set() };
    }
    const fieldArg = expression.args[0];
    const arrayArg = expression.args[1];
    if (fieldArg.type === `ref` &&
        arrayArg.type === `val` &&
        Array.isArray(arrayArg.value)) {
        const fieldPath = fieldArg.path;
        const values = arrayArg.value;
        const index = findIndexForField(indexes, fieldPath);
        if (index) {
            // Check if the index supports IN operation
            if (index.supports(IndexOperation.IN)) {
                const matchingKeys = index.lookup(IndexOperation.IN, values);
                return { canOptimize: true, matchingKeys };
            }
            else if (index.supports(IndexOperation.EQ)) {
                // Fallback to multiple equality lookups
                const matchingKeys = new Set();
                for (const value of values) {
                    const keysForValue = index.lookup(IndexOperation.EQ, value);
                    for (const key of keysForValue) {
                        matchingKeys.add(key);
                    }
                }
                return { canOptimize: true, matchingKeys };
            }
        }
    }
    return { canOptimize: false, matchingKeys: new Set() };
}
/**
 * Checks if an IN array expression can be optimized
 */
function canOptimizeInArrayExpression(expression, indexes) {
    if (expression.type !== `func` || expression.args.length !== 2) {
        return false;
    }
    const fieldArg = expression.args[0];
    const arrayArg = expression.args[1];
    if (fieldArg.type === `ref` &&
        arrayArg.type === `val` &&
        Array.isArray(arrayArg.value)) {
        const fieldPath = fieldArg.path;
        const index = findIndexForField(indexes, fieldPath);
        return index !== undefined;
    }
    return false;
}
