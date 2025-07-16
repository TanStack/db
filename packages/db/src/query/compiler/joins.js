import { consolidate, filter, join as joinOperator, map, } from "@electric-sql/d2mini";
import { compileExpression } from "./evaluators.js";
import { compileQuery } from "./index.js";
/**
 * Processes all join clauses in a query
 */
export function processJoins(pipeline, joinClauses, tables, mainTableAlias, allInputs, cache, queryMapping) {
    let resultPipeline = pipeline;
    for (const joinClause of joinClauses) {
        resultPipeline = processJoin(resultPipeline, joinClause, tables, mainTableAlias, allInputs, cache, queryMapping);
    }
    return resultPipeline;
}
/**
 * Processes a single join clause
 */
function processJoin(pipeline, joinClause, tables, mainTableAlias, allInputs, cache, queryMapping) {
    // Get the joined table alias and input stream
    const { alias: joinedTableAlias, input: joinedInput } = processJoinSource(joinClause.from, allInputs, cache, queryMapping);
    // Add the joined table to the tables map
    tables[joinedTableAlias] = joinedInput;
    // Convert join type to D2 join type
    const joinType = joinClause.type === `cross`
        ? `inner`
        : joinClause.type === `outer`
            ? `full`
            : joinClause.type;
    // Pre-compile the join expressions
    const compiledLeftExpr = compileExpression(joinClause.left);
    const compiledRightExpr = compileExpression(joinClause.right);
    // Prepare the main pipeline for joining
    const mainPipeline = pipeline.pipe(map(([currentKey, namespacedRow]) => {
        // Extract the join key from the left side of the join condition
        const leftKey = compiledLeftExpr(namespacedRow);
        // Return [joinKey, [originalKey, namespacedRow]]
        return [leftKey, [currentKey, namespacedRow]];
    }));
    // Prepare the joined pipeline
    const joinedPipeline = joinedInput.pipe(map(([currentKey, row]) => {
        // Wrap the row in a namespaced structure
        const namespacedRow = { [joinedTableAlias]: row };
        // Extract the join key from the right side of the join condition
        const rightKey = compiledRightExpr(namespacedRow);
        // Return [joinKey, [originalKey, namespacedRow]]
        return [rightKey, [currentKey, namespacedRow]];
    }));
    // Apply the join operation
    if (![`inner`, `left`, `right`, `full`].includes(joinType)) {
        throw new Error(`Unsupported join type: ${joinClause.type}`);
    }
    return mainPipeline.pipe(joinOperator(joinedPipeline, joinType), consolidate(), processJoinResults(joinClause.type));
}
/**
 * Processes the join source (collection or sub-query)
 */
function processJoinSource(from, allInputs, cache, queryMapping) {
    switch (from.type) {
        case `collectionRef`: {
            const input = allInputs[from.collection.id];
            if (!input) {
                throw new Error(`Input for collection "${from.collection.id}" not found in inputs map`);
            }
            return { alias: from.alias, input };
        }
        case `queryRef`: {
            // Find the original query for caching purposes
            const originalQuery = queryMapping.get(from.query) || from.query;
            // Recursively compile the sub-query with cache
            const subQueryInput = compileQuery(originalQuery, allInputs, cache, queryMapping);
            // Subqueries may return [key, [value, orderByIndex]] (with ORDER BY) or [key, value] (without ORDER BY)
            // We need to extract just the value for use in parent queries
            const extractedInput = subQueryInput.pipe(map((data) => {
                const [key, [value, _orderByIndex]] = data;
                return [key, value];
            }));
            return { alias: from.alias, input: extractedInput };
        }
        default:
            throw new Error(`Unsupported join source type: ${from.type}`);
    }
}
/**
 * Processes the results of a join operation
 */
function processJoinResults(joinType) {
    return function (pipeline) {
        return pipeline.pipe(
        // Process the join result and handle nulls
        filter((result) => {
            const [_key, [main, joined]] = result;
            const mainNamespacedRow = main?.[1];
            const joinedNamespacedRow = joined?.[1];
            // Handle different join types
            if (joinType === `inner`) {
                return !!(mainNamespacedRow && joinedNamespacedRow);
            }
            if (joinType === `left`) {
                return !!mainNamespacedRow;
            }
            if (joinType === `right`) {
                return !!joinedNamespacedRow;
            }
            // For full joins, always include
            return true;
        }), map((result) => {
            const [_key, [main, joined]] = result;
            const mainKey = main?.[0];
            const mainNamespacedRow = main?.[1];
            const joinedKey = joined?.[0];
            const joinedNamespacedRow = joined?.[1];
            // Merge the namespaced rows
            const mergedNamespacedRow = {};
            // Add main row data if it exists
            if (mainNamespacedRow) {
                Object.assign(mergedNamespacedRow, mainNamespacedRow);
            }
            // Add joined row data if it exists
            if (joinedNamespacedRow) {
                Object.assign(mergedNamespacedRow, joinedNamespacedRow);
            }
            // We create a composite key that combines the main and joined keys
            const resultKey = `[${mainKey},${joinedKey}]`;
            return [resultKey, mergedNamespacedRow];
        }));
    };
}
