// packages/db/dist/esm/query/ir.js
var BaseExpression = class {
}, CollectionRef = class extends BaseExpression {
  constructor(collection, alias) {
    super(), this.collection = collection, this.alias = alias, this.type = "collectionRef";
  }
}, QueryRef = class extends BaseExpression {
  constructor(query, alias) {
    super(), this.query = query, this.alias = alias, this.type = "queryRef";
  }
}, PropRef = class extends BaseExpression {
  constructor(path) {
    super(), this.path = path, this.type = "ref";
  }
}, Value = class extends BaseExpression {
  constructor(value) {
    super(), this.value = value, this.type = "val";
  }
}, Func = class extends BaseExpression {
  constructor(name, args) {
    super(), this.name = name, this.args = args, this.type = "func";
  }
}, Aggregate = class extends BaseExpression {
  constructor(name, args) {
    super(), this.name = name, this.args = args, this.type = "agg";
  }
};
function isExpressionLike(value) {
  return value instanceof Aggregate || value instanceof Func || value instanceof PropRef || value instanceof Value;
}
function getWhereExpression(where) {
  return typeof where == "object" && "expression" in where ? where.expression : where;
}
function getHavingExpression(having) {
  return typeof having == "object" && "expression" in having ? having.expression : having;
}
function isResidualWhere(where) {
  return typeof where == "object" && "expression" in where && where.residual === !0;
}
function createResidualWhere(expression) {
  return { expression, residual: !0 };
}
function getRefFromAlias(query, alias) {
  if (query.from.alias === alias)
    return query.from;
  for (let join2 of query.join || [])
    if (join2.from.alias === alias)
      return join2.from;
}
function followRef(query, ref, collection) {
  if (ref.path.length !== 0) {
    if (ref.path.length === 1) {
      let field = ref.path[0];
      if (query.select) {
        let selectedField = query.select[field];
        if (selectedField && selectedField.type === "ref")
          return followRef(query, selectedField, collection);
      }
      return { collection, path: [field] };
    }
    if (ref.path.length > 1) {
      let [alias, ...rest] = ref.path, aliasRef = getRefFromAlias(query, alias);
      return aliasRef ? aliasRef.type === "queryRef" ? followRef(aliasRef.query, new PropRef(rest), collection) : { collection: aliasRef.collection, path: rest } : void 0;
    }
  }
}

// packages/db/dist/esm/errors.js
var TanStackDBError = class extends Error {
  constructor(message) {
    super(message), this.name = "TanStackDBError";
  }
};
var SchemaValidationError = class extends TanStackDBError {
  constructor(type, issues, message) {
    let defaultMessage = `${type === "insert" ? "Insert" : "Update"} validation failed: ${issues.map((issue) => `
- ${issue.message} - path: ${issue.path}`).join("")}`;
    super(message || defaultMessage), this.name = "SchemaValidationError", this.type = type, this.issues = issues;
  }
}, CollectionConfigurationError = class extends TanStackDBError {
  constructor(message) {
    super(message), this.name = "CollectionConfigurationError";
  }
}, CollectionRequiresConfigError = class extends CollectionConfigurationError {
  constructor() {
    super("Collection requires a config");
  }
}, CollectionRequiresSyncConfigError = class extends CollectionConfigurationError {
  constructor() {
    super("Collection requires a sync config");
  }
}, InvalidSchemaError = class extends CollectionConfigurationError {
  constructor() {
    super("Schema must implement the standard-schema interface");
  }
}, SchemaMustBeSynchronousError = class extends CollectionConfigurationError {
  constructor() {
    super("Schema validation must be synchronous");
  }
}, CollectionStateError = class extends TanStackDBError {
  constructor(message) {
    super(message), this.name = "CollectionStateError";
  }
}, CollectionInErrorStateError = class extends CollectionStateError {
  constructor(operation, collectionId) {
    super(
      `Cannot perform ${operation} on collection "${collectionId}" - collection is in error state. Try calling cleanup() and restarting the collection.`
    );
  }
}, InvalidCollectionStatusTransitionError = class extends CollectionStateError {
  constructor(from, to, collectionId) {
    super(
      `Invalid collection status transition from "${from}" to "${to}" for collection "${collectionId}"`
    );
  }
}, CollectionIsInErrorStateError = class extends CollectionStateError {
  constructor() {
    super("Collection is in error state");
  }
}, NegativeActiveSubscribersError = class extends CollectionStateError {
  constructor() {
    super("Active subscribers count is negative - this should never happen");
  }
}, CollectionOperationError = class extends TanStackDBError {
  constructor(message) {
    super(message), this.name = "CollectionOperationError";
  }
}, UndefinedKeyError = class extends CollectionOperationError {
  constructor(item) {
    super(
      `An object was created without a defined key: ${JSON.stringify(item)}`
    );
  }
}, DuplicateKeyError = class extends CollectionOperationError {
  constructor(key) {
    super(
      `Cannot insert document with ID "${key}" because it already exists in the collection`
    );
  }
}, DuplicateKeySyncError = class extends CollectionOperationError {
  constructor(key, collectionId) {
    super(
      `Cannot insert document with key "${key}" from sync because it already exists in the collection "${collectionId}"`
    );
  }
}, MissingUpdateArgumentError = class extends CollectionOperationError {
  constructor() {
    super("The first argument to update is missing");
  }
}, NoKeysPassedToUpdateError = class extends CollectionOperationError {
  constructor() {
    super("No keys were passed to update");
  }
}, UpdateKeyNotFoundError = class extends CollectionOperationError {
  constructor(key) {
    super(
      `The key "${key}" was passed to update but an object for this key was not found in the collection`
    );
  }
}, KeyUpdateNotAllowedError = class extends CollectionOperationError {
  constructor(originalKey, newKey) {
    super(
      `Updating the key of an item is not allowed. Original key: "${originalKey}", Attempted new key: "${newKey}". Please delete the old item and create a new one if a key change is necessary.`
    );
  }
}, NoKeysPassedToDeleteError = class extends CollectionOperationError {
  constructor() {
    super("No keys were passed to delete");
  }
}, DeleteKeyNotFoundError = class extends CollectionOperationError {
  constructor(key) {
    super(
      `Collection.delete was called with key '${key}' but there is no item in the collection with this key`
    );
  }
}, MissingHandlerError = class extends TanStackDBError {
  constructor(message) {
    super(message), this.name = "MissingHandlerError";
  }
}, MissingInsertHandlerError = class extends MissingHandlerError {
  constructor() {
    super(
      "Collection.insert called directly (not within an explicit transaction) but no 'onInsert' handler is configured."
    );
  }
}, MissingUpdateHandlerError = class extends MissingHandlerError {
  constructor() {
    super(
      "Collection.update called directly (not within an explicit transaction) but no 'onUpdate' handler is configured."
    );
  }
}, MissingDeleteHandlerError = class extends MissingHandlerError {
  constructor() {
    super(
      "Collection.delete called directly (not within an explicit transaction) but no 'onDelete' handler is configured."
    );
  }
}, TransactionError = class extends TanStackDBError {
  constructor(message) {
    super(message), this.name = "TransactionError";
  }
}, MissingMutationFunctionError = class extends TransactionError {
  constructor() {
    super("mutationFn is required when creating a transaction");
  }
}, TransactionNotPendingMutateError = class extends TransactionError {
  constructor() {
    super(
      "You can no longer call .mutate() as the transaction is no longer pending"
    );
  }
}, TransactionAlreadyCompletedRollbackError = class extends TransactionError {
  constructor() {
    super(
      "You can no longer call .rollback() as the transaction is already completed"
    );
  }
}, TransactionNotPendingCommitError = class extends TransactionError {
  constructor() {
    super(
      "You can no longer call .commit() as the transaction is no longer pending"
    );
  }
}, NoPendingSyncTransactionWriteError = class extends TransactionError {
  constructor() {
    super("No pending sync transaction to write to");
  }
}, SyncTransactionAlreadyCommittedWriteError = class extends TransactionError {
  constructor() {
    super(
      "The pending sync transaction is already committed, you can't still write to it."
    );
  }
}, NoPendingSyncTransactionCommitError = class extends TransactionError {
  constructor() {
    super("No pending sync transaction to commit");
  }
}, SyncTransactionAlreadyCommittedError = class extends TransactionError {
  constructor() {
    super(
      "The pending sync transaction is already committed, you can't commit it again."
    );
  }
}, QueryBuilderError = class extends TanStackDBError {
  constructor(message) {
    super(message), this.name = "QueryBuilderError";
  }
}, OnlyOneSourceAllowedError = class extends QueryBuilderError {
  constructor(context) {
    super(`Only one source is allowed in the ${context}`);
  }
}, SubQueryMustHaveFromClauseError = class extends QueryBuilderError {
  constructor(context) {
    super(`A sub query passed to a ${context} must have a from clause itself`);
  }
}, InvalidSourceError = class extends QueryBuilderError {
  constructor(alias) {
    super(
      `Invalid source for live query: The value provided for alias "${alias}" is not a Collection or subquery. Live queries only accept Collection instances or subqueries. Please ensure you're passing a valid Collection or QueryBuilder, not a plain array or other data type.`
    );
  }
}, JoinConditionMustBeEqualityError = class extends QueryBuilderError {
  constructor() {
    super("Join condition must be an equality expression");
  }
}, QueryMustHaveFromClauseError = class extends QueryBuilderError {
  constructor() {
    super("Query must have a from clause");
  }
}, QueryCompilationError = class extends TanStackDBError {
  constructor(message) {
    super(message), this.name = "QueryCompilationError";
  }
}, DistinctRequiresSelectError = class extends QueryCompilationError {
  constructor() {
    super("DISTINCT requires a SELECT clause.");
  }
}, HavingRequiresGroupByError = class extends QueryCompilationError {
  constructor() {
    super("HAVING clause requires GROUP BY clause");
  }
}, LimitOffsetRequireOrderByError = class extends QueryCompilationError {
  constructor() {
    super(
      "LIMIT and OFFSET require an ORDER BY clause to ensure deterministic results"
    );
  }
}, CollectionInputNotFoundError = class extends QueryCompilationError {
  constructor(alias, collectionId, availableKeys) {
    let details = collectionId ? `alias "${alias}" (collection "${collectionId}")` : `collection "${alias}"`, availableKeysMsg = availableKeys?.length ? `. Available keys: ${availableKeys.join(", ")}` : "";
    super(`Input for ${details} not found in inputs map${availableKeysMsg}`);
  }
}, UnsupportedFromTypeError = class extends QueryCompilationError {
  constructor(type) {
    super(`Unsupported FROM type: ${type}`);
  }
}, UnknownExpressionTypeError = class extends QueryCompilationError {
  constructor(type) {
    super(`Unknown expression type: ${type}`);
  }
}, EmptyReferencePathError = class extends QueryCompilationError {
  constructor() {
    super("Reference path cannot be empty");
  }
}, UnknownFunctionError = class extends QueryCompilationError {
  constructor(functionName) {
    super(`Unknown function: ${functionName}`);
  }
}, JoinCollectionNotFoundError = class extends QueryCompilationError {
  constructor(collectionId) {
    super(`Collection "${collectionId}" not found during compilation of join`);
  }
}, JoinError = class extends TanStackDBError {
  constructor(message) {
    super(message), this.name = "JoinError";
  }
}, UnsupportedJoinTypeError = class extends JoinError {
  constructor(joinType) {
    super(`Unsupported join type: ${joinType}`);
  }
}, InvalidJoinConditionSameSourceError = class extends JoinError {
  constructor(sourceAlias) {
    super(
      `Invalid join condition: both expressions refer to the same source "${sourceAlias}"`
    );
  }
}, InvalidJoinConditionSourceMismatchError = class extends JoinError {
  constructor() {
    super("Invalid join condition: expressions must reference source aliases");
  }
}, InvalidJoinConditionLeftSourceError = class extends JoinError {
  constructor(sourceAlias) {
    super(
      `Invalid join condition: left expression refers to an unavailable source "${sourceAlias}"`
    );
  }
}, InvalidJoinConditionRightSourceError = class extends JoinError {
  constructor(sourceAlias) {
    super(
      `Invalid join condition: right expression does not refer to the joined source "${sourceAlias}"`
    );
  }
}, InvalidJoinCondition = class extends JoinError {
  constructor() {
    super("Invalid join condition");
  }
}, UnsupportedJoinSourceTypeError = class extends JoinError {
  constructor(type) {
    super(`Unsupported join source type: ${type}`);
  }
}, GroupByError = class extends TanStackDBError {
  constructor(message) {
    super(message), this.name = "GroupByError";
  }
}, NonAggregateExpressionNotInGroupByError = class extends GroupByError {
  constructor(alias) {
    super(
      `Non-aggregate expression '${alias}' in SELECT must also appear in GROUP BY clause`
    );
  }
}, UnsupportedAggregateFunctionError = class extends GroupByError {
  constructor(functionName) {
    super(`Unsupported aggregate function: ${functionName}`);
  }
}, AggregateFunctionNotInSelectError = class extends GroupByError {
  constructor(functionName) {
    super(
      `Aggregate function in HAVING clause must also be in SELECT clause: ${functionName}`
    );
  }
}, UnknownHavingExpressionTypeError = class extends GroupByError {
  constructor(type) {
    super(`Unknown expression type in HAVING clause: ${type}`);
  }
}, StorageError = class extends TanStackDBError {
  constructor(message) {
    super(message), this.name = "StorageError";
  }
}, SerializationError = class extends StorageError {
  constructor(operation, originalError) {
    super(
      `Cannot ${operation} item because it cannot be JSON serialized: ${originalError}`
    );
  }
}, LocalStorageCollectionError = class extends StorageError {
  constructor(message) {
    super(message), this.name = "LocalStorageCollectionError";
  }
}, StorageKeyRequiredError = class extends LocalStorageCollectionError {
  constructor() {
    super("[LocalStorageCollection] storageKey must be provided.");
  }
}, InvalidStorageDataFormatError = class extends LocalStorageCollectionError {
  constructor(storageKey, key) {
    super(
      `[LocalStorageCollection] Invalid data format in storage key "${storageKey}" for key "${key}".`
    );
  }
}, InvalidStorageObjectFormatError = class extends LocalStorageCollectionError {
  constructor(storageKey) {
    super(
      `[LocalStorageCollection] Invalid data format in storage key "${storageKey}". Expected object format.`
    );
  }
}, SyncCleanupError = class extends TanStackDBError {
  constructor(collectionId, error) {
    let message = error instanceof Error ? error.message : String(error);
    super(
      `Collection "${collectionId}" sync cleanup function threw an error: ${message}`
    ), this.name = "SyncCleanupError";
  }
}, QueryOptimizerError = class extends TanStackDBError {
  constructor(message) {
    super(message), this.name = "QueryOptimizerError";
  }
}, CannotCombineEmptyExpressionListError = class extends QueryOptimizerError {
  constructor() {
    super("Cannot combine empty expression list");
  }
}, WhereClauseConversionError = class extends QueryOptimizerError {
  constructor(collectionId, alias) {
    super(
      `Failed to convert WHERE clause to collection filter for collection '${collectionId}' alias '${alias}'. This indicates a bug in the query optimization logic.`
    );
  }
}, SubscriptionNotFoundError = class extends QueryCompilationError {
  constructor(resolvedAlias, originalAlias, collectionId, availableAliases) {
    super(
      `Internal error: subscription for alias '${resolvedAlias}' (remapped from '${originalAlias}', collection '${collectionId}') is missing in join pipeline. Available aliases: ${availableAliases.join(", ")}. This indicates a bug in alias tracking.`
    );
  }
};
var MissingAliasInputsError = class extends QueryCompilationError {
  constructor(missingAliases) {
    super(
      `Internal error: compiler returned aliases without inputs: ${missingAliases.join(", ")}. This indicates a bug in query compilation. Please report this issue.`
    );
  }
}, SetWindowRequiresOrderByError = class extends QueryCompilationError {
  constructor() {
    super(
      "setWindow() can only be called on collections with an ORDER BY clause. Add .orderBy() to your query to enable window movement."
    );
  }
};

// packages/db/dist/esm/utils/comparison.js
var objectIds = /* @__PURE__ */ new WeakMap(), nextObjectId = 1;
function getObjectId(obj) {
  if (objectIds.has(obj))
    return objectIds.get(obj);
  let id = nextObjectId++;
  return objectIds.set(obj, id), id;
}
var ascComparator = (a, b, opts) => {
  let { nulls } = opts;
  if (a == null && b == null) return 0;
  if (a == null) return nulls === "first" ? -1 : 1;
  if (b == null) return nulls === "first" ? 1 : -1;
  if (typeof a == "string" && typeof b == "string" && opts.stringSort === "locale")
    return a.localeCompare(b, opts.locale, opts.localeOptions);
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      let result = ascComparator(a[i], b[i], opts);
      if (result !== 0)
        return result;
    }
    return a.length - b.length;
  }
  if (a instanceof Date && b instanceof Date)
    return a.getTime() - b.getTime();
  let aIsObject = typeof a == "object", bIsObject = typeof b == "object";
  if (aIsObject || bIsObject) {
    if (aIsObject && bIsObject) {
      let aId = getObjectId(a), bId = getObjectId(b);
      return aId - bId;
    }
    if (aIsObject) return 1;
    if (bIsObject) return -1;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}, descComparator = (a, b, opts) => ascComparator(b, a, {
  ...opts,
  nulls: opts.nulls === "first" ? "last" : "first"
});
function makeComparator(opts) {
  return (a, b) => opts.direction === "asc" ? ascComparator(a, b, opts) : descComparator(a, b, opts);
}
var defaultComparator = makeComparator({
  direction: "asc",
  nulls: "first",
  stringSort: "locale"
});
function normalizeValue(value) {
  return value instanceof Date ? value.getTime() : value;
}

// packages/db/dist/esm/query/compiler/evaluators.js
function compileExpression(expr, isSingleRow = !1) {
  return compileExpressionInternal(expr, isSingleRow);
}
function compileSingleRowExpression(expr) {
  return compileExpressionInternal(expr, !0);
}
function compileExpressionInternal(expr, isSingleRow) {
  switch (expr.type) {
    case "val": {
      let value = expr.value;
      return () => value;
    }
    case "ref":
      return isSingleRow ? compileSingleRowRef(expr) : compileRef(expr);
    case "func":
      return compileFunction(expr, isSingleRow);
    default:
      throw new UnknownExpressionTypeError(expr.type);
  }
}
function compileRef(ref) {
  let [tableAlias, ...propertyPath] = ref.path;
  if (!tableAlias)
    throw new EmptyReferencePathError();
  if (propertyPath.length === 0)
    return (namespacedRow) => namespacedRow[tableAlias];
  if (propertyPath.length === 1) {
    let prop = propertyPath[0];
    return (namespacedRow) => namespacedRow[tableAlias]?.[prop];
  } else
    return (namespacedRow) => {
      let tableData = namespacedRow[tableAlias];
      if (tableData === void 0)
        return;
      let value = tableData;
      for (let prop of propertyPath) {
        if (value == null)
          return value;
        value = value[prop];
      }
      return value;
    };
}
function compileSingleRowRef(ref) {
  let propertyPath = ref.path;
  return (item) => {
    let value = item;
    for (let prop of propertyPath) {
      if (value == null)
        return value;
      value = value[prop];
    }
    return value;
  };
}
function compileFunction(func, isSingleRow) {
  let compiledArgs = func.args.map(
    (arg) => compileExpressionInternal(arg, isSingleRow)
  );
  switch (func.name) {
    // Comparison operators
    case "eq": {
      let argA = compiledArgs[0], argB = compiledArgs[1];
      return (data) => {
        let a = normalizeValue(argA(data)), b = normalizeValue(argB(data));
        return a === b;
      };
    }
    case "gt": {
      let argA = compiledArgs[0], argB = compiledArgs[1];
      return (data) => {
        let a = argA(data), b = argB(data);
        return a > b;
      };
    }
    case "gte": {
      let argA = compiledArgs[0], argB = compiledArgs[1];
      return (data) => {
        let a = argA(data), b = argB(data);
        return a >= b;
      };
    }
    case "lt": {
      let argA = compiledArgs[0], argB = compiledArgs[1];
      return (data) => {
        let a = argA(data), b = argB(data);
        return a < b;
      };
    }
    case "lte": {
      let argA = compiledArgs[0], argB = compiledArgs[1];
      return (data) => {
        let a = argA(data), b = argB(data);
        return a <= b;
      };
    }
    // Boolean operators
    case "and":
      return (data) => {
        for (let compiledArg of compiledArgs)
          if (!compiledArg(data))
            return !1;
        return !0;
      };
    case "or":
      return (data) => {
        for (let compiledArg of compiledArgs)
          if (compiledArg(data))
            return !0;
        return !1;
      };
    case "not": {
      let arg = compiledArgs[0];
      return (data) => !arg(data);
    }
    // Array operators
    case "in": {
      let valueEvaluator = compiledArgs[0], arrayEvaluator = compiledArgs[1];
      return (data) => {
        let value = valueEvaluator(data), array = arrayEvaluator(data);
        return Array.isArray(array) ? array.includes(value) : !1;
      };
    }
    // String operators
    case "like": {
      let valueEvaluator = compiledArgs[0], patternEvaluator = compiledArgs[1];
      return (data) => {
        let value = valueEvaluator(data), pattern = patternEvaluator(data);
        return evaluateLike(value, pattern, !1);
      };
    }
    case "ilike": {
      let valueEvaluator = compiledArgs[0], patternEvaluator = compiledArgs[1];
      return (data) => {
        let value = valueEvaluator(data), pattern = patternEvaluator(data);
        return evaluateLike(value, pattern, !0);
      };
    }
    // String functions
    case "upper": {
      let arg = compiledArgs[0];
      return (data) => {
        let value = arg(data);
        return typeof value == "string" ? value.toUpperCase() : value;
      };
    }
    case "lower": {
      let arg = compiledArgs[0];
      return (data) => {
        let value = arg(data);
        return typeof value == "string" ? value.toLowerCase() : value;
      };
    }
    case "length": {
      let arg = compiledArgs[0];
      return (data) => {
        let value = arg(data);
        return typeof value == "string" || Array.isArray(value) ? value.length : 0;
      };
    }
    case "concat":
      return (data) => compiledArgs.map((evaluator) => {
        let arg = evaluator(data);
        try {
          return String(arg ?? "");
        } catch {
          try {
            return JSON.stringify(arg) || "";
          } catch {
            return "[object]";
          }
        }
      }).join("");
    case "coalesce":
      return (data) => {
        for (let evaluator of compiledArgs) {
          let value = evaluator(data);
          if (value != null)
            return value;
        }
        return null;
      };
    // Math functions
    case "add": {
      let argA = compiledArgs[0], argB = compiledArgs[1];
      return (data) => {
        let a = argA(data), b = argB(data);
        return (a ?? 0) + (b ?? 0);
      };
    }
    case "subtract": {
      let argA = compiledArgs[0], argB = compiledArgs[1];
      return (data) => {
        let a = argA(data), b = argB(data);
        return (a ?? 0) - (b ?? 0);
      };
    }
    case "multiply": {
      let argA = compiledArgs[0], argB = compiledArgs[1];
      return (data) => {
        let a = argA(data), b = argB(data);
        return (a ?? 0) * (b ?? 0);
      };
    }
    case "divide": {
      let argA = compiledArgs[0], argB = compiledArgs[1];
      return (data) => {
        let a = argA(data), divisor = argB(data) ?? 0;
        return divisor !== 0 ? (a ?? 0) / divisor : null;
      };
    }
    // Null/undefined checking functions
    case "isUndefined": {
      let arg = compiledArgs[0];
      return (data) => arg(data) === void 0;
    }
    case "isNull": {
      let arg = compiledArgs[0];
      return (data) => arg(data) === null;
    }
    default:
      throw new UnknownFunctionError(func.name);
  }
}
function evaluateLike(value, pattern, caseInsensitive) {
  if (typeof value != "string" || typeof pattern != "string")
    return !1;
  let searchValue = caseInsensitive ? value.toLowerCase() : value, regexPattern = (caseInsensitive ? pattern.toLowerCase() : pattern).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return regexPattern = regexPattern.replace(/%/g, ".*"), regexPattern = regexPattern.replace(/_/g, "."), new RegExp(`^${regexPattern}$`).test(searchValue);
}

// packages/db/dist/esm/utils.js
function deepEquals(a, b) {
  return deepEqualsInternal(a, b, /* @__PURE__ */ new Map());
}
function deepEqualsInternal(a, b, visited) {
  if (a === b) return !0;
  if (a == null || b == null || typeof a != typeof b) return !1;
  if (a instanceof Date)
    return b instanceof Date ? a.getTime() === b.getTime() : !1;
  if (a instanceof RegExp)
    return b instanceof RegExp ? a.source === b.source && a.flags === b.flags : !1;
  if (a instanceof Map) {
    if (!(b instanceof Map) || a.size !== b.size) return !1;
    if (visited.has(a))
      return visited.get(a) === b;
    visited.set(a, b);
    let result = Array.from(a.entries()).every(([key, val]) => b.has(key) && deepEqualsInternal(val, b.get(key), visited));
    return visited.delete(a), result;
  }
  if (a instanceof Set) {
    if (!(b instanceof Set) || a.size !== b.size) return !1;
    if (visited.has(a))
      return visited.get(a) === b;
    visited.set(a, b);
    let aValues = Array.from(a), bValues = Array.from(b);
    if (aValues.every((val) => typeof val != "object"))
      return visited.delete(a), aValues.every((val) => b.has(val));
    let result = aValues.length === bValues.length;
    return visited.delete(a), result;
  }
  if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b) && !(a instanceof DataView) && !(b instanceof DataView)) {
    let typedA = a, typedB = b;
    if (typedA.length !== typedB.length) return !1;
    for (let i = 0; i < typedA.length; i++)
      if (typedA[i] !== typedB[i]) return !1;
    return !0;
  }
  if (isTemporal(a) && isTemporal(b)) {
    let aTag = getStringTag(a), bTag = getStringTag(b);
    return aTag !== bTag ? !1 : typeof a.equals == "function" ? a.equals(b) : a.toString() === b.toString();
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return !1;
    if (visited.has(a))
      return visited.get(a) === b;
    visited.set(a, b);
    let result = a.every(
      (item, index) => deepEqualsInternal(item, b[index], visited)
    );
    return visited.delete(a), result;
  }
  if (typeof a == "object") {
    if (visited.has(a))
      return visited.get(a) === b;
    visited.set(a, b);
    let keysA = Object.keys(a), keysB = Object.keys(b);
    if (keysA.length !== keysB.length)
      return visited.delete(a), !1;
    let result = keysA.every(
      (key) => key in b && deepEqualsInternal(a[key], b[key], visited)
    );
    return visited.delete(a), result;
  }
  return !1;
}
var temporalTypes = [
  "Temporal.Duration",
  "Temporal.Instant",
  "Temporal.PlainDate",
  "Temporal.PlainDateTime",
  "Temporal.PlainMonthDay",
  "Temporal.PlainTime",
  "Temporal.PlainYearMonth",
  "Temporal.ZonedDateTime"
];
function getStringTag(a) {
  return a[Symbol.toStringTag];
}
function isTemporal(a) {
  let tag = getStringTag(a);
  return typeof tag == "string" && temporalTypes.includes(tag);
}
var DEFAULT_COMPARE_OPTIONS = {
  direction: "asc",
  nulls: "first",
  stringSort: "locale"
};

// packages/db/dist/esm/indexes/reverse-index.js
var ReverseIndex = class {
  constructor(index) {
    this.originalIndex = index;
  }
  // Define the reversed operations
  lookup(operation, value) {
    let reverseOperation = operation === "gt" ? "lt" : operation === "gte" ? "lte" : operation === "lt" ? "gt" : operation === "lte" ? "gte" : operation;
    return this.originalIndex.lookup(reverseOperation, value);
  }
  rangeQuery(options = {}) {
    return this.originalIndex.rangeQueryReversed(options);
  }
  rangeQueryReversed(options = {}) {
    return this.originalIndex.rangeQuery(options);
  }
  take(n, from, filterFn) {
    return this.originalIndex.takeReversed(n, from, filterFn);
  }
  takeReversed(n, from, filterFn) {
    return this.originalIndex.take(n, from, filterFn);
  }
  get orderedEntriesArray() {
    return this.originalIndex.orderedEntriesArrayReversed;
  }
  get orderedEntriesArrayReversed() {
    return this.originalIndex.orderedEntriesArray;
  }
  // All operations below delegate to the original index
  supports(operation) {
    return this.originalIndex.supports(operation);
  }
  matchesField(fieldPath) {
    return this.originalIndex.matchesField(fieldPath);
  }
  matchesCompareOptions(compareOptions) {
    return this.originalIndex.matchesCompareOptions(compareOptions);
  }
  matchesDirection(direction) {
    return this.originalIndex.matchesDirection(direction);
  }
  getStats() {
    return this.originalIndex.getStats();
  }
  add(key, item) {
    this.originalIndex.add(key, item);
  }
  remove(key, item) {
    this.originalIndex.remove(key, item);
  }
  update(key, oldItem, newItem) {
    this.originalIndex.update(key, oldItem, newItem);
  }
  build(entries) {
    this.originalIndex.build(entries);
  }
  clear() {
    this.originalIndex.clear();
  }
  get keyCount() {
    return this.originalIndex.keyCount;
  }
  equalityLookup(value) {
    return this.originalIndex.equalityLookup(value);
  }
  inArrayLookup(values) {
    return this.originalIndex.inArrayLookup(values);
  }
  get indexedKeysSet() {
    return this.originalIndex.indexedKeysSet;
  }
  get valueMapData() {
    return this.originalIndex.valueMapData;
  }
};

// packages/db/dist/esm/utils/index-optimization.js
function findIndexForField(indexes, fieldPath, compareOptions = DEFAULT_COMPARE_OPTIONS) {
  for (let index of indexes.values())
    if (index.matchesField(fieldPath) && index.matchesCompareOptions(compareOptions))
      return index.matchesDirection(compareOptions.direction) ? index : new ReverseIndex(index);
}
function intersectSets(sets) {
  if (sets.length === 0) return /* @__PURE__ */ new Set();
  if (sets.length === 1) return new Set(sets[0]);
  let result = new Set(sets[0]);
  for (let i = 1; i < sets.length; i++) {
    let newResult = /* @__PURE__ */ new Set();
    for (let item of result)
      sets[i].has(item) && newResult.add(item);
    result = newResult;
  }
  return result;
}
function unionSets(sets) {
  let result = /* @__PURE__ */ new Set();
  for (let set of sets)
    for (let item of set)
      result.add(item);
  return result;
}
function optimizeExpressionWithIndexes(expression, indexes) {
  return optimizeQueryRecursive(expression, indexes);
}
function optimizeQueryRecursive(expression, indexes) {
  if (expression.type === "func")
    switch (expression.name) {
      case "eq":
      case "gt":
      case "gte":
      case "lt":
      case "lte":
        return optimizeSimpleComparison(expression, indexes);
      case "and":
        return optimizeAndExpression(expression, indexes);
      case "or":
        return optimizeOrExpression(expression, indexes);
      case "in":
        return optimizeInArrayExpression(expression, indexes);
    }
  return { canOptimize: !1, matchingKeys: /* @__PURE__ */ new Set() };
}
function optimizeCompoundRangeQuery(expression, indexes) {
  if (expression.type !== "func" || expression.args.length < 2)
    return { canOptimize: !1, matchingKeys: /* @__PURE__ */ new Set() };
  let fieldOperations = /* @__PURE__ */ new Map();
  for (let arg of expression.args)
    if (arg.type === "func" && ["gt", "gte", "lt", "lte"].includes(arg.name)) {
      let rangeOp = arg;
      if (rangeOp.args.length === 2) {
        let leftArg = rangeOp.args[0], rightArg = rangeOp.args[1], fieldArg = null, valueArg = null, operation = rangeOp.name;
        if (leftArg.type === "ref" && rightArg.type === "val")
          fieldArg = leftArg, valueArg = rightArg;
        else if (leftArg.type === "val" && rightArg.type === "ref")
          switch (fieldArg = rightArg, valueArg = leftArg, operation) {
            case "gt":
              operation = "lt";
              break;
            case "gte":
              operation = "lte";
              break;
            case "lt":
              operation = "gt";
              break;
            case "lte":
              operation = "gte";
              break;
          }
        if (fieldArg && valueArg) {
          let fieldKey = fieldArg.path.join("."), value = valueArg.value;
          fieldOperations.has(fieldKey) || fieldOperations.set(fieldKey, []), fieldOperations.get(fieldKey).push({ operation, value });
        }
      }
    }
  for (let [fieldKey, operations] of fieldOperations)
    if (operations.length >= 2) {
      let fieldPath = fieldKey.split("."), index = findIndexForField(indexes, fieldPath);
      if (index && index.supports("gt") && index.supports("lt")) {
        let from, to, fromInclusive = !0, toInclusive = !0;
        for (let { operation, value } of operations)
          switch (operation) {
            case "gt":
              (from === void 0 || value > from) && (from = value, fromInclusive = !1);
              break;
            case "gte":
              (from === void 0 || value > from) && (from = value, fromInclusive = !0);
              break;
            case "lt":
              (to === void 0 || value < to) && (to = value, toInclusive = !1);
              break;
            case "lte":
              (to === void 0 || value < to) && (to = value, toInclusive = !0);
              break;
          }
        return { canOptimize: !0, matchingKeys: index.rangeQuery({
          from,
          to,
          fromInclusive,
          toInclusive
        }) };
      }
    }
  return { canOptimize: !1, matchingKeys: /* @__PURE__ */ new Set() };
}
function optimizeSimpleComparison(expression, indexes) {
  if (expression.type !== "func" || expression.args.length !== 2)
    return { canOptimize: !1, matchingKeys: /* @__PURE__ */ new Set() };
  let leftArg = expression.args[0], rightArg = expression.args[1], fieldArg = null, valueArg = null, operation = expression.name;
  if (leftArg.type === "ref" && rightArg.type === "val")
    fieldArg = leftArg, valueArg = rightArg;
  else if (leftArg.type === "val" && rightArg.type === "ref")
    switch (fieldArg = rightArg, valueArg = leftArg, operation) {
      case "gt":
        operation = "lt";
        break;
      case "gte":
        operation = "lte";
        break;
      case "lt":
        operation = "gt";
        break;
      case "lte":
        operation = "gte";
        break;
    }
  if (fieldArg && valueArg) {
    let fieldPath = fieldArg.path, index = findIndexForField(indexes, fieldPath);
    if (index) {
      let queryValue = valueArg.value, indexOperation = operation;
      return index.supports(indexOperation) ? { canOptimize: !0, matchingKeys: index.lookup(indexOperation, queryValue) } : { canOptimize: !1, matchingKeys: /* @__PURE__ */ new Set() };
    }
  }
  return { canOptimize: !1, matchingKeys: /* @__PURE__ */ new Set() };
}
function optimizeAndExpression(expression, indexes) {
  if (expression.type !== "func" || expression.args.length < 2)
    return { canOptimize: !1, matchingKeys: /* @__PURE__ */ new Set() };
  let compoundRangeResult = optimizeCompoundRangeQuery(expression, indexes);
  if (compoundRangeResult.canOptimize)
    return compoundRangeResult;
  let results = [];
  for (let arg of expression.args) {
    let result = optimizeQueryRecursive(arg, indexes);
    result.canOptimize && results.push(result);
  }
  if (results.length > 0) {
    let allMatchingSets = results.map((r) => r.matchingKeys);
    return { canOptimize: !0, matchingKeys: intersectSets(allMatchingSets) };
  }
  return { canOptimize: !1, matchingKeys: /* @__PURE__ */ new Set() };
}
function optimizeOrExpression(expression, indexes) {
  if (expression.type !== "func" || expression.args.length < 2)
    return { canOptimize: !1, matchingKeys: /* @__PURE__ */ new Set() };
  let results = [];
  for (let arg of expression.args) {
    let result = optimizeQueryRecursive(arg, indexes);
    result.canOptimize && results.push(result);
  }
  if (results.length > 0) {
    let allMatchingSets = results.map((r) => r.matchingKeys);
    return { canOptimize: !0, matchingKeys: unionSets(allMatchingSets) };
  }
  return { canOptimize: !1, matchingKeys: /* @__PURE__ */ new Set() };
}
function optimizeInArrayExpression(expression, indexes) {
  if (expression.type !== "func" || expression.args.length !== 2)
    return { canOptimize: !1, matchingKeys: /* @__PURE__ */ new Set() };
  let fieldArg = expression.args[0], arrayArg = expression.args[1];
  if (fieldArg.type === "ref" && arrayArg.type === "val" && Array.isArray(arrayArg.value)) {
    let fieldPath = fieldArg.path, values = arrayArg.value, index = findIndexForField(indexes, fieldPath);
    if (index) {
      if (index.supports("in"))
        return { canOptimize: !0, matchingKeys: index.lookup("in", values) };
      if (index.supports("eq")) {
        let matchingKeys = /* @__PURE__ */ new Set();
        for (let value of values) {
          let keysForValue = index.lookup("eq", value);
          for (let key of keysForValue)
            matchingKeys.add(key);
        }
        return { canOptimize: !0, matchingKeys };
      }
    }
  }
  return { canOptimize: !1, matchingKeys: /* @__PURE__ */ new Set() };
}

// packages/db/dist/esm/utils/btree.js
var BTree = class {
  /**
   * Initializes an empty B+ tree.
   * @param compare Custom function to compare pairs of elements in the tree.
   *   If not specified, defaultComparator will be used which is valid as long as K extends DefaultComparable.
   * @param entries A set of key-value pairs to initialize the tree
   * @param maxNodeSize Branching factor (maximum items or children per node)
   *   Must be in range 4..256. If undefined or <4 then default is used; if >256 then 256.
   */
  constructor(compare, entries, maxNodeSize) {
    this._root = EmptyLeaf, this._size = 0, this._maxNodeSize = maxNodeSize >= 4 ? Math.min(maxNodeSize, 256) : 32, this._compare = compare, entries && this.setPairs(entries);
  }
  // ///////////////////////////////////////////////////////////////////////////
  // ES6 Map<K,V> methods /////////////////////////////////////////////////////
  /** Gets the number of key-value pairs in the tree. */
  get size() {
    return this._size;
  }
  /** Gets the number of key-value pairs in the tree. */
  get length() {
    return this._size;
  }
  /** Returns true iff the tree contains no key-value pairs. */
  get isEmpty() {
    return this._size === 0;
  }
  /** Releases the tree so that its size is 0. */
  clear() {
    this._root = EmptyLeaf, this._size = 0;
  }
  /**
   * Finds a pair in the tree and returns the associated value.
   * @param defaultValue a value to return if the key was not found.
   * @returns the value, or defaultValue if the key was not found.
   * @description Computational complexity: O(log size)
   */
  get(key, defaultValue) {
    return this._root.get(key, defaultValue, this);
  }
  /**
   * Adds or overwrites a key-value pair in the B+ tree.
   * @param key the key is used to determine the sort order of
   *        data in the tree.
   * @param value data to associate with the key (optional)
   * @param overwrite Whether to overwrite an existing key-value pair
   *        (default: true). If this is false and there is an existing
   *        key-value pair then this method has no effect.
   * @returns true if a new key-value pair was added.
   * @description Computational complexity: O(log size)
   * Note: when overwriting a previous entry, the key is updated
   * as well as the value. This has no effect unless the new key
   * has data that does not affect its sort order.
   */
  set(key, value, overwrite) {
    this._root.isShared && (this._root = this._root.clone());
    let result = this._root.set(key, value, overwrite, this);
    return result === !0 || result === !1 ? result : (this._root = new BNodeInternal([this._root, result]), !0);
  }
  /**
   * Returns true if the key exists in the B+ tree, false if not.
   * Use get() for best performance; use has() if you need to
   * distinguish between "undefined value" and "key not present".
   * @param key Key to detect
   * @description Computational complexity: O(log size)
   */
  has(key) {
    return this.forRange(key, key, !0, void 0) !== 0;
  }
  /**
   * Removes a single key-value pair from the B+ tree.
   * @param key Key to find
   * @returns true if a pair was found and removed, false otherwise.
   * @description Computational complexity: O(log size)
   */
  delete(key) {
    return this.editRange(key, key, !0, DeleteRange) !== 0;
  }
  // ///////////////////////////////////////////////////////////////////////////
  // Additional methods ///////////////////////////////////////////////////////
  /** Returns the maximum number of children/values before nodes will split. */
  get maxNodeSize() {
    return this._maxNodeSize;
  }
  /** Gets the lowest key in the tree. Complexity: O(log size) */
  minKey() {
    return this._root.minKey();
  }
  /** Gets the highest key in the tree. Complexity: O(1) */
  maxKey() {
    return this._root.maxKey();
  }
  /** Gets an array of all keys, sorted */
  keysArray() {
    let results = [];
    return this._root.forRange(
      this.minKey(),
      this.maxKey(),
      !0,
      !1,
      this,
      0,
      (k, _v) => {
        results.push(k);
      }
    ), results;
  }
  /** Returns the next pair whose key is larger than the specified key (or undefined if there is none).
   * If key === undefined, this function returns the lowest pair.
   * @param key The key to search for.
   * @param reusedArray Optional array used repeatedly to store key-value pairs, to
   * avoid creating a new array on every iteration.
   */
  nextHigherPair(key, reusedArray) {
    return reusedArray = reusedArray || [], key === void 0 ? this._root.minPair(reusedArray) : this._root.getPairOrNextHigher(
      key,
      this._compare,
      !1,
      reusedArray
    );
  }
  /** Returns the next key larger than the specified key, or undefined if there is none.
   *  Also, nextHigherKey(undefined) returns the lowest key.
   */
  nextHigherKey(key) {
    let p = this.nextHigherPair(key, ReusedArray);
    return p && p[0];
  }
  /** Returns the next pair whose key is smaller than the specified key (or undefined if there is none).
   *  If key === undefined, this function returns the highest pair.
   * @param key The key to search for.
   * @param reusedArray Optional array used repeatedly to store key-value pairs, to
   *        avoid creating a new array each time you call this method.
   */
  nextLowerPair(key, reusedArray) {
    return reusedArray = reusedArray || [], key === void 0 ? this._root.maxPair(reusedArray) : this._root.getPairOrNextLower(key, this._compare, !1, reusedArray);
  }
  /** Returns the next key smaller than the specified key, or undefined if there is none.
   *  Also, nextLowerKey(undefined) returns the highest key.
   */
  nextLowerKey(key) {
    let p = this.nextLowerPair(key, ReusedArray);
    return p && p[0];
  }
  /** Adds all pairs from a list of key-value pairs.
   * @param pairs Pairs to add to this tree. If there are duplicate keys,
   *        later pairs currently overwrite earlier ones (e.g. [[0,1],[0,7]]
   *        associates 0 with 7.)
   * @param overwrite Whether to overwrite pairs that already exist (if false,
   *        pairs[i] is ignored when the key pairs[i][0] already exists.)
   * @returns The number of pairs added to the collection.
   * @description Computational complexity: O(pairs.length * log(size + pairs.length))
   */
  setPairs(pairs, overwrite) {
    let added = 0;
    for (let pair of pairs)
      this.set(pair[0], pair[1], overwrite) && added++;
    return added;
  }
  /**
   * Scans the specified range of keys, in ascending order by key.
   * Note: the callback `onFound` must not insert or remove items in the
   * collection. Doing so may cause incorrect data to be sent to the
   * callback afterward.
   * @param low The first key scanned will be greater than or equal to `low`.
   * @param high Scanning stops when a key larger than this is reached.
   * @param includeHigh If the `high` key is present, `onFound` is called for
   *        that final pair if and only if this parameter is true.
   * @param onFound A function that is called for each key-value pair. This
   *        function can return {break:R} to stop early with result R.
   * @param initialCounter Initial third argument of onFound. This value
   *        increases by one each time `onFound` is called. Default: 0
   * @returns The number of values found, or R if the callback returned
   *        `{break:R}` to stop early.
   * @description Computational complexity: O(number of items scanned + log size)
   */
  forRange(low, high, includeHigh, onFound, initialCounter) {
    let r = this._root.forRange(
      low,
      high,
      includeHigh,
      !1,
      this,
      initialCounter || 0,
      onFound
    );
    return typeof r == "number" ? r : r.break;
  }
  /**
   * Scans and potentially modifies values for a subsequence of keys.
   * Note: the callback `onFound` should ideally be a pure function.
   *   Specfically, it must not insert items, call clone(), or change
   *   the collection except via return value; out-of-band editing may
   *   cause an exception or may cause incorrect data to be sent to
   *   the callback (duplicate or missed items). It must not cause a
   *   clone() of the collection, otherwise the clone could be modified
   *   by changes requested by the callback.
   * @param low The first key scanned will be greater than or equal to `low`.
   * @param high Scanning stops when a key larger than this is reached.
   * @param includeHigh If the `high` key is present, `onFound` is called for
   *        that final pair if and only if this parameter is true.
   * @param onFound A function that is called for each key-value pair. This
   *        function can return `{value:v}` to change the value associated
   *        with the current key, `{delete:true}` to delete the current pair,
   *        `{break:R}` to stop early with result R, or it can return nothing
   *        (undefined or {}) to cause no effect and continue iterating.
   *        `{break:R}` can be combined with one of the other two commands.
   *        The third argument `counter` is the number of items iterated
   *        previously; it equals 0 when `onFound` is called the first time.
   * @returns The number of values scanned, or R if the callback returned
   *        `{break:R}` to stop early.
   * @description
   *   Computational complexity: O(number of items scanned + log size)
   *   Note: if the tree has been cloned with clone(), any shared
   *   nodes are copied before `onFound` is called. This takes O(n) time
   *   where n is proportional to the amount of shared data scanned.
   */
  editRange(low, high, includeHigh, onFound, initialCounter) {
    let root = this._root;
    root.isShared && (this._root = root = root.clone());
    try {
      let r = root.forRange(
        low,
        high,
        includeHigh,
        !0,
        this,
        initialCounter || 0,
        onFound
      );
      return typeof r == "number" ? r : r.break;
    } finally {
      let isShared;
      for (; root.keys.length <= 1 && !root.isLeaf; )
        isShared ||= root.isShared, this._root = root = root.keys.length === 0 ? EmptyLeaf : root.children[0];
      isShared && (root.isShared = !0);
    }
  }
}, BNode = class _BNode {
  get isLeaf() {
    return this.children === void 0;
  }
  constructor(keys = [], values) {
    this.keys = keys, this.values = values || undefVals, this.isShared = void 0;
  }
  // /////////////////////////////////////////////////////////////////////////
  // Shared methods /////////////////////////////////////////////////////////
  maxKey() {
    return this.keys[this.keys.length - 1];
  }
  // If key not found, returns i^failXor where i is the insertion index.
  // Callers that don't care whether there was a match will set failXor=0.
  indexOf(key, failXor, cmp) {
    let keys = this.keys, lo = 0, hi = keys.length, mid = hi >> 1;
    for (; lo < hi; ) {
      let c = cmp(keys[mid], key);
      if (c < 0) lo = mid + 1;
      else if (c > 0)
        hi = mid;
      else {
        if (c === 0) return mid;
        if (key === key)
          return keys.length;
        throw new Error("BTree: NaN was used as a key");
      }
      mid = lo + hi >> 1;
    }
    return mid ^ failXor;
  }
  // ///////////////////////////////////////////////////////////////////////////
  // Leaf Node: misc //////////////////////////////////////////////////////////
  minKey() {
    return this.keys[0];
  }
  minPair(reusedArray) {
    if (this.keys.length !== 0)
      return reusedArray[0] = this.keys[0], reusedArray[1] = this.values[0], reusedArray;
  }
  maxPair(reusedArray) {
    if (this.keys.length === 0) return;
    let lastIndex = this.keys.length - 1;
    return reusedArray[0] = this.keys[lastIndex], reusedArray[1] = this.values[lastIndex], reusedArray;
  }
  clone() {
    let v = this.values;
    return new _BNode(this.keys.slice(0), v === undefVals ? v : v.slice(0));
  }
  get(key, defaultValue, tree) {
    let i = this.indexOf(key, -1, tree._compare);
    return i < 0 ? defaultValue : this.values[i];
  }
  getPairOrNextLower(key, compare, inclusive, reusedArray) {
    let i = this.indexOf(key, -1, compare), indexOrLower = i < 0 ? ~i - 1 : inclusive ? i : i - 1;
    if (indexOrLower >= 0)
      return reusedArray[0] = this.keys[indexOrLower], reusedArray[1] = this.values[indexOrLower], reusedArray;
  }
  getPairOrNextHigher(key, compare, inclusive, reusedArray) {
    let i = this.indexOf(key, -1, compare), indexOrLower = i < 0 ? ~i : inclusive ? i : i + 1, keys = this.keys;
    if (indexOrLower < keys.length)
      return reusedArray[0] = keys[indexOrLower], reusedArray[1] = this.values[indexOrLower], reusedArray;
  }
  // ///////////////////////////////////////////////////////////////////////////
  // Leaf Node: set & node splitting //////////////////////////////////////////
  set(key, value, overwrite, tree) {
    let i = this.indexOf(key, -1, tree._compare);
    if (i < 0) {
      if (i = ~i, tree._size++, this.keys.length < tree._maxNodeSize)
        return this.insertInLeaf(i, key, value, tree);
      {
        let newRightSibling = this.splitOffRightSide(), target = this;
        return i > this.keys.length && (i -= this.keys.length, target = newRightSibling), target.insertInLeaf(i, key, value, tree), newRightSibling;
      }
    } else
      return overwrite !== !1 && (value !== void 0 && this.reifyValues(), this.keys[i] = key, this.values[i] = value), !1;
  }
  reifyValues() {
    return this.values === undefVals ? this.values = this.values.slice(0, this.keys.length) : this.values;
  }
  insertInLeaf(i, key, value, tree) {
    if (this.keys.splice(i, 0, key), this.values === undefVals) {
      for (; undefVals.length < tree._maxNodeSize; ) undefVals.push(void 0);
      if (value === void 0)
        return !0;
      this.values = undefVals.slice(0, this.keys.length - 1);
    }
    return this.values.splice(i, 0, value), !0;
  }
  takeFromRight(rhs) {
    let v = this.values;
    rhs.values === undefVals ? v !== undefVals && v.push(void 0) : (v = this.reifyValues(), v.push(rhs.values.shift())), this.keys.push(rhs.keys.shift());
  }
  takeFromLeft(lhs) {
    let v = this.values;
    lhs.values === undefVals ? v !== undefVals && v.unshift(void 0) : (v = this.reifyValues(), v.unshift(lhs.values.pop())), this.keys.unshift(lhs.keys.pop());
  }
  splitOffRightSide() {
    let half = this.keys.length >> 1, keys = this.keys.splice(half), values = this.values === undefVals ? undefVals : this.values.splice(half);
    return new _BNode(keys, values);
  }
  // ///////////////////////////////////////////////////////////////////////////
  // Leaf Node: scanning & deletions //////////////////////////////////////////
  forRange(low, high, includeHigh, editMode, tree, count3, onFound) {
    let cmp = tree._compare, iLow, iHigh;
    if (high === low) {
      if (!includeHigh || (iHigh = (iLow = this.indexOf(low, -1, cmp)) + 1, iLow < 0)) return count3;
    } else
      iLow = this.indexOf(low, 0, cmp), iHigh = this.indexOf(high, -1, cmp), iHigh < 0 ? iHigh = ~iHigh : includeHigh === !0 && iHigh++;
    let keys = this.keys, values = this.values;
    if (onFound !== void 0)
      for (let i = iLow; i < iHigh; i++) {
        let key = keys[i], result = onFound(key, values[i], count3++);
        if (result !== void 0) {
          if (editMode === !0) {
            if (key !== keys[i] || this.isShared === !0)
              throw new Error("BTree illegally changed or cloned in editRange");
            result.delete ? (this.keys.splice(i, 1), this.values !== undefVals && this.values.splice(i, 1), tree._size--, i--, iHigh--) : result.hasOwnProperty("value") && (values[i] = result.value);
          }
          if (result.break !== void 0) return result;
        }
      }
    else count3 += iHigh - iLow;
    return count3;
  }
  /** Adds entire contents of right-hand sibling (rhs is left unchanged) */
  mergeSibling(rhs, _) {
    if (this.keys.push.apply(this.keys, rhs.keys), this.values === undefVals) {
      if (rhs.values === undefVals) return;
      this.values = this.values.slice(0, this.keys.length);
    }
    this.values.push.apply(this.values, rhs.reifyValues());
  }
}, BNodeInternal = class _BNodeInternal extends BNode {
  /**
   * This does not mark `children` as shared, so it is the responsibility of the caller
   * to ensure children are either marked shared, or aren't included in another tree.
   */
  constructor(children, keys) {
    if (!keys) {
      keys = [];
      for (let i = 0; i < children.length; i++) keys[i] = children[i].maxKey();
    }
    super(keys), this.children = children;
  }
  minKey() {
    return this.children[0].minKey();
  }
  minPair(reusedArray) {
    return this.children[0].minPair(reusedArray);
  }
  maxPair(reusedArray) {
    return this.children[this.children.length - 1].maxPair(reusedArray);
  }
  get(key, defaultValue, tree) {
    let i = this.indexOf(key, 0, tree._compare), children = this.children;
    return i < children.length ? children[i].get(key, defaultValue, tree) : void 0;
  }
  getPairOrNextLower(key, compare, inclusive, reusedArray) {
    let i = this.indexOf(key, 0, compare), children = this.children;
    if (i >= children.length) return this.maxPair(reusedArray);
    let result = children[i].getPairOrNextLower(
      key,
      compare,
      inclusive,
      reusedArray
    );
    return result === void 0 && i > 0 ? children[i - 1].maxPair(reusedArray) : result;
  }
  getPairOrNextHigher(key, compare, inclusive, reusedArray) {
    let i = this.indexOf(key, 0, compare), children = this.children, length = children.length;
    if (i >= length) return;
    let result = children[i].getPairOrNextHigher(
      key,
      compare,
      inclusive,
      reusedArray
    );
    return result === void 0 && i < length - 1 ? children[i + 1].minPair(reusedArray) : result;
  }
  // ///////////////////////////////////////////////////////////////////////////
  // Internal Node: set & node splitting //////////////////////////////////////
  set(key, value, overwrite, tree) {
    let c = this.children, max2 = tree._maxNodeSize, cmp = tree._compare, i = Math.min(this.indexOf(key, 0, cmp), c.length - 1), child = c[i];
    if (child.isShared && (c[i] = child = child.clone()), child.keys.length >= max2) {
      let other;
      i > 0 && (other = c[i - 1]).keys.length < max2 && cmp(child.keys[0], key) < 0 ? (other.isShared && (c[i - 1] = other = other.clone()), other.takeFromRight(child), this.keys[i - 1] = other.maxKey()) : (other = c[i + 1]) !== void 0 && other.keys.length < max2 && cmp(child.maxKey(), key) < 0 && (other.isShared && (c[i + 1] = other = other.clone()), other.takeFromLeft(child), this.keys[i] = c[i].maxKey());
    }
    let result = child.set(key, value, overwrite, tree);
    if (result === !1) return !1;
    if (this.keys[i] = child.maxKey(), result === !0) return !0;
    if (this.keys.length < max2)
      return this.insert(i + 1, result), !0;
    {
      let newRightSibling = this.splitOffRightSide(), target = this;
      return cmp(result.maxKey(), this.maxKey()) > 0 && (target = newRightSibling, i -= this.keys.length), target.insert(i + 1, result), newRightSibling;
    }
  }
  /**
   * Inserts `child` at index `i`.
   * This does not mark `child` as shared, so it is the responsibility of the caller
   * to ensure that either child is marked shared, or it is not included in another tree.
   */
  insert(i, child) {
    this.children.splice(i, 0, child), this.keys.splice(i, 0, child.maxKey());
  }
  /**
   * Split this node.
   * Modifies this to remove the second half of the items, returning a separate node containing them.
   */
  splitOffRightSide() {
    let half = this.children.length >> 1;
    return new _BNodeInternal(
      this.children.splice(half),
      this.keys.splice(half)
    );
  }
  takeFromRight(rhs) {
    this.keys.push(rhs.keys.shift()), this.children.push(rhs.children.shift());
  }
  takeFromLeft(lhs) {
    this.keys.unshift(lhs.keys.pop()), this.children.unshift(lhs.children.pop());
  }
  // ///////////////////////////////////////////////////////////////////////////
  // Internal Node: scanning & deletions //////////////////////////////////////
  // Note: `count` is the next value of the third argument to `onFound`.
  //       A leaf node's `forRange` function returns a new value for this counter,
  //       unless the operation is to stop early.
  forRange(low, high, includeHigh, editMode, tree, count3, onFound) {
    let cmp = tree._compare, keys = this.keys, children = this.children, iLow = this.indexOf(low, 0, cmp), i = iLow, iHigh = Math.min(
      high === low ? iLow : this.indexOf(high, 0, cmp),
      keys.length - 1
    );
    if (editMode) {
      if (i <= iHigh)
        try {
          for (; i <= iHigh; i++) {
            children[i].isShared && (children[i] = children[i].clone());
            let result = children[i].forRange(
              low,
              high,
              includeHigh,
              editMode,
              tree,
              count3,
              onFound
            );
            if (keys[i] = children[i].maxKey(), typeof result != "number") return result;
            count3 = result;
          }
        } finally {
          let half = tree._maxNodeSize >> 1;
          for (iLow > 0 && iLow--, i = iHigh; i >= iLow; i--)
            children[i].keys.length <= half && (children[i].keys.length !== 0 ? this.tryMerge(i, tree._maxNodeSize) : (keys.splice(i, 1), children.splice(i, 1)));
          children.length !== 0 && children[0].keys.length === 0 && check(!1, "emptiness bug");
        }
    } else for (; i <= iHigh; i++) {
      let result = children[i].forRange(
        low,
        high,
        includeHigh,
        editMode,
        tree,
        count3,
        onFound
      );
      if (typeof result != "number") return result;
      count3 = result;
    }
    return count3;
  }
  /** Merges child i with child i+1 if their combined size is not too large */
  tryMerge(i, maxSize) {
    let children = this.children;
    return i >= 0 && i + 1 < children.length && children[i].keys.length + children[i + 1].keys.length <= maxSize ? (children[i].isShared && (children[i] = children[i].clone()), children[i].mergeSibling(children[i + 1], maxSize), children.splice(i + 1, 1), this.keys.splice(i + 1, 1), this.keys[i] = children[i].maxKey(), !0) : !1;
  }
  /**
   * Move children from `rhs` into this.
   * `rhs` must be part of this tree, and be removed from it after this call
   * (otherwise isShared for its children could be incorrect).
   */
  mergeSibling(rhs, maxNodeSize) {
    let oldLength = this.keys.length;
    this.keys.push.apply(this.keys, rhs.keys);
    let rhsChildren = rhs.children;
    if (this.children.push.apply(this.children, rhsChildren), rhs.isShared && !this.isShared)
      for (let child of rhsChildren) child.isShared = !0;
    this.tryMerge(oldLength - 1, maxNodeSize);
  }
}, undefVals = [], Delete = { delete: !0 }, DeleteRange = () => Delete, EmptyLeaf = (function() {
  let n = new BNode();
  return n.isShared = !0, n;
})(), ReusedArray = [];
function check(fact, ...args) {
  throw args.unshift("B+ tree"), new Error(args.join(" "));
}

// packages/db/dist/esm/query/builder/ref-proxy.js
function createSingleRowRefProxy() {
  let cache = /* @__PURE__ */ new Map();
  function createProxy(path) {
    let pathKey = path.join(".");
    if (cache.has(pathKey))
      return cache.get(pathKey);
    let proxy = new Proxy({}, {
      get(target, prop, receiver) {
        if (prop === "__refProxy") return !0;
        if (prop === "__path") return path;
        if (prop === "__type") return;
        if (typeof prop == "symbol") return Reflect.get(target, prop, receiver);
        let newPath = [...path, String(prop)];
        return createProxy(newPath);
      },
      has(target, prop) {
        return prop === "__refProxy" || prop === "__path" || prop === "__type" ? !0 : Reflect.has(target, prop);
      },
      ownKeys(target) {
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(target, prop) {
        return prop === "__refProxy" || prop === "__path" || prop === "__type" ? { enumerable: !1, configurable: !0 } : Reflect.getOwnPropertyDescriptor(target, prop);
      }
    });
    return cache.set(pathKey, proxy), proxy;
  }
  return createProxy([]);
}
function createRefProxy(aliases) {
  let cache = /* @__PURE__ */ new Map(), accessId = 0;
  function createProxy(path) {
    let pathKey = path.join(".");
    if (cache.has(pathKey))
      return cache.get(pathKey);
    let proxy = new Proxy({}, {
      get(target, prop, receiver) {
        if (prop === "__refProxy") return !0;
        if (prop === "__path") return path;
        if (prop === "__type") return;
        if (typeof prop == "symbol") return Reflect.get(target, prop, receiver);
        let newPath = [...path, String(prop)];
        return createProxy(newPath);
      },
      has(target, prop) {
        return prop === "__refProxy" || prop === "__path" || prop === "__type" ? !0 : Reflect.has(target, prop);
      },
      ownKeys(target) {
        let id = ++accessId, sentinelKey = `__SPREAD_SENTINEL__${path.join(".")}__${id}`;
        return Object.prototype.hasOwnProperty.call(target, sentinelKey) || Object.defineProperty(target, sentinelKey, {
          enumerable: !0,
          configurable: !0,
          value: !0
        }), Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(target, prop) {
        return prop === "__refProxy" || prop === "__path" || prop === "__type" ? { enumerable: !1, configurable: !0 } : Reflect.getOwnPropertyDescriptor(target, prop);
      }
    });
    return cache.set(pathKey, proxy), proxy;
  }
  return new Proxy({}, {
    get(target, prop, receiver) {
      if (prop === "__refProxy") return !0;
      if (prop === "__path") return [];
      if (prop === "__type") return;
      if (typeof prop == "symbol") return Reflect.get(target, prop, receiver);
      let propStr = String(prop);
      if (aliases.includes(propStr))
        return createProxy([propStr]);
    },
    has(target, prop) {
      return prop === "__refProxy" || prop === "__path" || prop === "__type" || typeof prop == "string" && aliases.includes(prop) ? !0 : Reflect.has(target, prop);
    },
    ownKeys(_target) {
      return [...aliases, "__refProxy", "__path", "__type"];
    },
    getOwnPropertyDescriptor(target, prop) {
      if (prop === "__refProxy" || prop === "__path" || prop === "__type")
        return { enumerable: !1, configurable: !0 };
      if (typeof prop == "string" && aliases.includes(prop))
        return { enumerable: !0, configurable: !0 };
    }
  });
}
function toExpression(value) {
  return isRefProxy(value) ? new PropRef(value.__path) : value && typeof value == "object" && "type" in value && (value.type === "func" || value.type === "ref" || value.type === "val" || value.type === "agg") ? value : new Value(value);
}
function isRefProxy(value) {
  return value && typeof value == "object" && value.__refProxy === !0;
}

// packages/db/dist/esm/query/builder/functions.js
function gt(left, right) {
  return new Func("gt", [toExpression(left), toExpression(right)]);
}
function lt(left, right) {
  return new Func("lt", [toExpression(left), toExpression(right)]);
}
function and(left, right, ...rest) {
  let allArgs = [left, right, ...rest];
  return new Func(
    "and",
    allArgs.map((arg) => toExpression(arg))
  );
}
function inArray(value, array) {
  return new Func("in", [toExpression(value), toExpression(array)]);
}

// packages/db/dist/esm/indexes/base-index.js
var BaseIndex = class {
  constructor(id, expression, name, options) {
    this.lookupCount = 0, this.totalLookupTime = 0, this.lastUpdated = /* @__PURE__ */ new Date(), this.id = id, this.expression = expression, this.compareOptions = DEFAULT_COMPARE_OPTIONS, this.name = name, this.initialize(options);
  }
  // Common methods
  supports(operation) {
    return this.supportedOperations.has(operation);
  }
  matchesField(fieldPath) {
    return this.expression.type === "ref" && this.expression.path.length === fieldPath.length && this.expression.path.every((part, i) => part === fieldPath[i]);
  }
  /**
   * Checks if the compare options match the index's compare options.
   * The direction is ignored because the index can be reversed if the direction is different.
   */
  matchesCompareOptions(compareOptions) {
    let thisCompareOptionsWithoutDirection = {
      ...this.compareOptions,
      direction: void 0
    }, compareOptionsWithoutDirection = {
      ...compareOptions,
      direction: void 0
    };
    return deepEquals(
      thisCompareOptionsWithoutDirection,
      compareOptionsWithoutDirection
    );
  }
  /**
   * Checks if the index matches the provided direction.
   */
  matchesDirection(direction) {
    return this.compareOptions.direction === direction;
  }
  getStats() {
    return {
      entryCount: this.keyCount,
      lookupCount: this.lookupCount,
      averageLookupTime: this.lookupCount > 0 ? this.totalLookupTime / this.lookupCount : 0,
      lastUpdated: this.lastUpdated
    };
  }
  evaluateIndexExpression(item) {
    return compileSingleRowExpression(this.expression)(item);
  }
  trackLookup(startTime) {
    let duration = performance.now() - startTime;
    this.lookupCount++, this.totalLookupTime += duration;
  }
  updateTimestamp() {
    this.lastUpdated = /* @__PURE__ */ new Date();
  }
};

// packages/db/dist/esm/indexes/btree-index.js
var BTreeIndex = class extends BaseIndex {
  constructor(id, expression, name, options) {
    super(id, expression, name, options), this.supportedOperations = /* @__PURE__ */ new Set([
      "eq",
      "gt",
      "gte",
      "lt",
      "lte",
      "in"
    ]), this.valueMap = /* @__PURE__ */ new Map(), this.indexedKeys = /* @__PURE__ */ new Set(), this.compareFn = defaultComparator, this.compareFn = options?.compareFn ?? defaultComparator, options?.compareOptions && (this.compareOptions = options.compareOptions), this.orderedEntries = new BTree(this.compareFn);
  }
  initialize(_options) {
  }
  /**
   * Adds a value to the index
   */
  add(key, item) {
    let indexedValue;
    try {
      indexedValue = this.evaluateIndexExpression(item);
    } catch (error) {
      throw new Error(
        `Failed to evaluate index expression for key ${key}: ${error}`
      );
    }
    let normalizedValue = normalizeValue(indexedValue);
    if (this.valueMap.has(normalizedValue))
      this.valueMap.get(normalizedValue).add(key);
    else {
      let keySet = /* @__PURE__ */ new Set([key]);
      this.valueMap.set(normalizedValue, keySet), this.orderedEntries.set(normalizedValue, void 0);
    }
    this.indexedKeys.add(key), this.updateTimestamp();
  }
  /**
   * Removes a value from the index
   */
  remove(key, item) {
    let indexedValue;
    try {
      indexedValue = this.evaluateIndexExpression(item);
    } catch (error) {
      console.warn(
        `Failed to evaluate index expression for key ${key} during removal:`,
        error
      );
      return;
    }
    let normalizedValue = normalizeValue(indexedValue);
    if (this.valueMap.has(normalizedValue)) {
      let keySet = this.valueMap.get(normalizedValue);
      keySet.delete(key), keySet.size === 0 && (this.valueMap.delete(normalizedValue), this.orderedEntries.delete(normalizedValue));
    }
    this.indexedKeys.delete(key), this.updateTimestamp();
  }
  /**
   * Updates a value in the index
   */
  update(key, oldItem, newItem) {
    this.remove(key, oldItem), this.add(key, newItem);
  }
  /**
   * Builds the index from a collection of entries
   */
  build(entries) {
    this.clear();
    for (let [key, item] of entries)
      this.add(key, item);
  }
  /**
   * Clears all data from the index
   */
  clear() {
    this.orderedEntries.clear(), this.valueMap.clear(), this.indexedKeys.clear(), this.updateTimestamp();
  }
  /**
   * Performs a lookup operation
   */
  lookup(operation, value) {
    let startTime = performance.now(), result;
    switch (operation) {
      case "eq":
        result = this.equalityLookup(value);
        break;
      case "gt":
        result = this.rangeQuery({ from: value, fromInclusive: !1 });
        break;
      case "gte":
        result = this.rangeQuery({ from: value, fromInclusive: !0 });
        break;
      case "lt":
        result = this.rangeQuery({ to: value, toInclusive: !1 });
        break;
      case "lte":
        result = this.rangeQuery({ to: value, toInclusive: !0 });
        break;
      case "in":
        result = this.inArrayLookup(value);
        break;
      default:
        throw new Error(`Operation ${operation} not supported by BTreeIndex`);
    }
    return this.trackLookup(startTime), result;
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
    let normalizedValue = normalizeValue(value);
    return new Set(this.valueMap.get(normalizedValue) ?? []);
  }
  /**
   * Performs a range query with options
   * This is more efficient for compound queries like "WHERE a > 5 AND a < 10"
   */
  rangeQuery(options = {}) {
    let { from, to, fromInclusive = !0, toInclusive = !0 } = options, result = /* @__PURE__ */ new Set(), normalizedFrom = normalizeValue(from), normalizedTo = normalizeValue(to), fromKey = normalizedFrom ?? this.orderedEntries.minKey(), toKey = normalizedTo ?? this.orderedEntries.maxKey();
    return this.orderedEntries.forRange(
      fromKey,
      toKey,
      toInclusive,
      (indexedValue, _) => {
        if (!fromInclusive && this.compareFn(indexedValue, from) === 0)
          return;
        let keys = this.valueMap.get(indexedValue);
        keys && keys.forEach((key) => result.add(key));
      }
    ), result;
  }
  /**
   * Performs a reversed range query
   */
  rangeQueryReversed(options = {}) {
    let { from, to, fromInclusive = !0, toInclusive = !0 } = options;
    return this.rangeQuery({
      from: to ?? this.orderedEntries.maxKey(),
      to: from ?? this.orderedEntries.minKey(),
      fromInclusive: toInclusive,
      toInclusive: fromInclusive
    });
  }
  takeInternal(n, nextPair, from, filterFn) {
    let keysInResult = /* @__PURE__ */ new Set(), result = [], pair, key = normalizeValue(from);
    for (; (pair = nextPair(key)) !== void 0 && result.length < n; ) {
      key = pair[0];
      let keys = this.valueMap.get(key);
      if (keys) {
        let it = keys.values(), ks;
        for (; result.length < n && (ks = it.next().value); )
          !keysInResult.has(ks) && (filterFn?.(ks) ?? !0) && (result.push(ks), keysInResult.add(ks));
      }
    }
    return result;
  }
  /**
   * Returns the next n items after the provided item or the first n items if no from item is provided.
   * @param n - The number of items to return
   * @param from - The item to start from (exclusive). Starts from the smallest item (inclusive) if not provided.
   * @returns The next n items after the provided key. Returns the first n items if no from item is provided.
   */
  take(n, from, filterFn) {
    let nextPair = (k) => this.orderedEntries.nextHigherPair(k);
    return this.takeInternal(n, nextPair, from, filterFn);
  }
  /**
   * Returns the next n items **before** the provided item (in descending order) or the last n items if no from item is provided.
   * @param n - The number of items to return
   * @param from - The item to start from (exclusive). Starts from the largest item (inclusive) if not provided.
   * @returns The next n items **before** the provided key. Returns the last n items if no from item is provided.
   */
  takeReversed(n, from, filterFn) {
    let nextPair = (k) => this.orderedEntries.nextLowerPair(k);
    return this.takeInternal(n, nextPair, from, filterFn);
  }
  /**
   * Performs an IN array lookup
   */
  inArrayLookup(values) {
    let result = /* @__PURE__ */ new Set();
    for (let value of values) {
      let normalizedValue = normalizeValue(value), keys = this.valueMap.get(normalizedValue);
      keys && keys.forEach((key) => result.add(key));
    }
    return result;
  }
  // Getter methods for testing compatibility
  get indexedKeysSet() {
    return this.indexedKeys;
  }
  get orderedEntriesArray() {
    return this.orderedEntries.keysArray().map((key) => [key, this.valueMap.get(key) ?? /* @__PURE__ */ new Set()]);
  }
  get orderedEntriesArrayReversed() {
    return this.takeReversed(this.orderedEntries.size).map((key) => [
      key,
      this.valueMap.get(key) ?? /* @__PURE__ */ new Set()
    ]);
  }
  get valueMapData() {
    return this.valueMap;
  }
};

// packages/db/dist/esm/indexes/auto-index.js
function shouldAutoIndex(collection) {
  return collection.config.autoIndex === "eager";
}
function ensureIndexForField(fieldName, fieldPath, collection, compareOptions = DEFAULT_COMPARE_OPTIONS, compareFn) {
  if (!(!shouldAutoIndex(collection) || Array.from(collection.indexes.values()).find(
    (index) => index.matchesField(fieldPath) && index.matchesCompareOptions(compareOptions)
  )))
    try {
      collection.createIndex((row) => row[fieldName], {
        name: `auto_${fieldName}`,
        indexType: BTreeIndex,
        options: compareFn ? { compareFn, compareOptions } : {}
      });
    } catch (error) {
      console.warn(
        `${collection.id ? `[${collection.id}] ` : ""}Failed to create auto-index for field "${fieldName}":`,
        error
      );
    }
}
function ensureIndexForExpression(expression, collection) {
  if (!shouldAutoIndex(collection))
    return;
  let indexableExpressions = extractIndexableExpressions(expression);
  for (let { fieldName, fieldPath } of indexableExpressions)
    ensureIndexForField(fieldName, fieldPath, collection);
}
function extractIndexableExpressions(expression) {
  let results = [];
  function extractFromExpression(expr) {
    if (expr.type !== "func")
      return;
    let func = expr;
    if (func.name === "and") {
      for (let arg of func.args)
        extractFromExpression(arg);
      return;
    }
    if (!["eq", "gt", "gte", "lt", "lte", "in"].includes(func.name) || func.args.length < 1 || func.args[0].type !== "ref")
      return;
    let fieldPath = func.args[0].path;
    if (fieldPath.length !== 1)
      return;
    let fieldName = fieldPath[0];
    results.push({ fieldName, fieldPath });
  }
  return extractFromExpression(expression), results;
}

// packages/db/dist/esm/collection/change-events.js
function currentStateAsChanges(collection, options = {}) {
  let collectFilteredResults = (filterFn) => {
    let result = [];
    for (let [key, value] of collection.entries())
      (filterFn?.(value) ?? !0) && result.push({
        type: "insert",
        key,
        value
      });
    return result;
  };
  if (options.limit !== void 0 && !options.orderBy)
    throw new Error("limit cannot be used without orderBy");
  if (options.orderBy) {
    let whereFilter = options.where ? createFilterFunctionFromExpression(options.where) : void 0, orderedKeys = getOrderedKeys(
      collection,
      options.orderBy,
      options.limit,
      whereFilter,
      options.optimizedOnly
    );
    if (orderedKeys === void 0)
      return;
    let result = [];
    for (let key of orderedKeys) {
      let value = collection.get(key);
      value !== void 0 && result.push({
        type: "insert",
        key,
        value
      });
    }
    return result;
  }
  if (!options.where)
    return collectFilteredResults();
  try {
    let expression = options.where, optimizationResult = optimizeExpressionWithIndexes(
      expression,
      collection.indexes
    );
    if (optimizationResult.canOptimize) {
      let result = [];
      for (let key of optimizationResult.matchingKeys) {
        let value = collection.get(key);
        value !== void 0 && result.push({
          type: "insert",
          key,
          value
        });
      }
      return result;
    } else {
      if (options.optimizedOnly)
        return;
      let filterFn = createFilterFunctionFromExpression(expression);
      return collectFilteredResults(filterFn);
    }
  } catch (error) {
    console.warn(
      `${collection.id ? `[${collection.id}] ` : ""}Error processing where clause, falling back to full scan:`,
      error
    );
    let filterFn = createFilterFunctionFromExpression(options.where);
    return options.optimizedOnly ? void 0 : collectFilteredResults(filterFn);
  }
}
function createFilterFunctionFromExpression(expression) {
  return (item) => {
    try {
      return !!compileSingleRowExpression(expression)(item);
    } catch {
      return !1;
    }
  };
}
function createFilteredCallback(originalCallback, options) {
  let filterFn = createFilterFunctionFromExpression(options.whereExpression);
  return (changes) => {
    let filteredChanges = [];
    for (let change of changes)
      if (change.type === "insert")
        filterFn(change.value) && filteredChanges.push(change);
      else if (change.type === "update") {
        let newValueMatches = filterFn(change.value), oldValueMatches = change.previousValue ? filterFn(change.previousValue) : !1;
        newValueMatches && oldValueMatches ? filteredChanges.push(change) : newValueMatches && !oldValueMatches ? filteredChanges.push({
          ...change,
          type: "insert"
        }) : !newValueMatches && oldValueMatches && filteredChanges.push({
          ...change,
          type: "delete",
          value: change.previousValue
          // Use the previous value for the delete
        });
      } else
        filterFn(change.value) && filteredChanges.push(change);
    (filteredChanges.length > 0 || changes.length === 0) && originalCallback(filteredChanges);
  };
}
function getOrderedKeys(collection, orderBy, limit, whereFilter, optimizedOnly) {
  if (orderBy.length === 1) {
    let clause = orderBy[0], orderByExpression = clause.expression;
    if (orderByExpression.type === "ref") {
      let fieldPath = orderByExpression.path;
      ensureIndexForField(
        fieldPath[0],
        fieldPath,
        collection,
        clause.compareOptions
      );
      let index = findIndexForField(
        collection.indexes,
        fieldPath,
        clause.compareOptions
      );
      if (index && index.supports("gt")) {
        let filterFn = (key) => {
          let value = collection.get(key);
          return value === void 0 ? !1 : whereFilter?.(value) ?? !0;
        };
        return index.take(limit ?? index.keyCount, void 0, filterFn);
      }
    }
  }
  if (optimizedOnly)
    return;
  let allItems = [];
  for (let [key, value] of collection.entries())
    (whereFilter?.(value) ?? !0) && allItems.push({ key, value });
  let compare = (a, b) => {
    for (let clause of orderBy) {
      let compareFn = makeComparator(clause.compareOptions), aValue = extractValueFromItem(a.value, clause.expression), bValue = extractValueFromItem(b.value, clause.expression), result = compareFn(aValue, bValue);
      if (result !== 0)
        return result;
    }
    return 0;
  };
  allItems.sort(compare);
  let sortedKeys = allItems.map((item) => item.key);
  return limit !== void 0 ? sortedKeys.slice(0, limit) : sortedKeys;
}
function extractValueFromItem(item, expression) {
  if (expression.type === "ref") {
    let propRef = expression, value = item;
    for (let pathPart of propRef.path)
      value = value?.[pathPart];
    return value;
  } else return expression.type === "val" ? expression.value : compileSingleRowExpression(expression)(item);
}

// packages/db/dist/esm/SortedMap.js
var SortedMap = class {
  /**
   * Creates a new SortedMap instance
   *
   * @param comparator - Optional function to compare values for sorting
   */
  constructor(comparator) {
    this.map = /* @__PURE__ */ new Map(), this.sortedKeys = [], this.comparator = comparator || this.defaultComparator;
  }
  /**
   * Default comparator function used when none is provided
   *
   * @param a - First value to compare
   * @param b - Second value to compare
   * @returns -1 if a < b, 1 if a > b, 0 if equal
   */
  defaultComparator(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  /**
   * Finds the index where a key-value pair should be inserted to maintain sort order.
   * Uses binary search to find the correct position based on the value.
   * Hence, it is in O(log n) time.
   *
   * @param key - The key to find position for
   * @param value - The value to compare against
   * @returns The index where the key should be inserted
   */
  indexOf(value) {
    let left = 0, right = this.sortedKeys.length;
    for (; left < right; ) {
      let mid = Math.floor((left + right) / 2), midKey = this.sortedKeys[mid], midValue = this.map.get(midKey), comparison = this.comparator(value, midValue);
      if (comparison < 0)
        right = mid;
      else if (comparison > 0)
        left = mid + 1;
      else
        return mid;
    }
    return left;
  }
  /**
   * Sets a key-value pair in the map and maintains sort order
   *
   * @param key - The key to set
   * @param value - The value to associate with the key
   * @returns This SortedMap instance for chaining
   */
  set(key, value) {
    if (this.map.has(key)) {
      let oldValue = this.map.get(key), oldIndex = this.indexOf(oldValue);
      this.sortedKeys.splice(oldIndex, 1);
    }
    let index = this.indexOf(value);
    return this.sortedKeys.splice(index, 0, key), this.map.set(key, value), this;
  }
  /**
   * Gets a value by its key
   *
   * @param key - The key to look up
   * @returns The value associated with the key, or undefined if not found
   */
  get(key) {
    return this.map.get(key);
  }
  /**
   * Removes a key-value pair from the map
   *
   * @param key - The key to remove
   * @returns True if the key was found and removed, false otherwise
   */
  delete(key) {
    if (this.map.has(key)) {
      let oldValue = this.map.get(key), index = this.indexOf(oldValue);
      return this.sortedKeys.splice(index, 1), this.map.delete(key);
    }
    return !1;
  }
  /**
   * Checks if a key exists in the map
   *
   * @param key - The key to check
   * @returns True if the key exists, false otherwise
   */
  has(key) {
    return this.map.has(key);
  }
  /**
   * Removes all key-value pairs from the map
   */
  clear() {
    this.map.clear(), this.sortedKeys = [];
  }
  /**
   * Gets the number of key-value pairs in the map
   */
  get size() {
    return this.map.size;
  }
  /**
   * Default iterator that returns entries in sorted order
   *
   * @returns An iterator for the map's entries
   */
  *[Symbol.iterator]() {
    for (let key of this.sortedKeys)
      yield [key, this.map.get(key)];
  }
  /**
   * Returns an iterator for the map's entries in sorted order
   *
   * @returns An iterator for the map's entries
   */
  entries() {
    return this[Symbol.iterator]();
  }
  /**
   * Returns an iterator for the map's keys in sorted order
   *
   * @returns An iterator for the map's keys
   */
  keys() {
    return this.sortedKeys[Symbol.iterator]();
  }
  /**
   * Returns an iterator for the map's values in sorted order
   *
   * @returns An iterator for the map's values
   */
  values() {
    return (function* () {
      for (let key of this.sortedKeys)
        yield this.map.get(key);
    }).call(this);
  }
  /**
   * Executes a callback function for each key-value pair in the map in sorted order
   *
   * @param callbackfn - Function to execute for each entry
   */
  forEach(callbackfn) {
    for (let key of this.sortedKeys)
      callbackfn(this.map.get(key), key, this.map);
  }
};

// packages/db/dist/esm/collection/state.js
var CollectionStateManager = class {
  /**
   * Creates a new CollectionState manager
   */
  constructor(config) {
    this.pendingSyncedTransactions = [], this.syncedMetadata = /* @__PURE__ */ new Map(), this.optimisticUpserts = /* @__PURE__ */ new Map(), this.optimisticDeletes = /* @__PURE__ */ new Set(), this.size = 0, this.syncedKeys = /* @__PURE__ */ new Set(), this.preSyncVisibleState = /* @__PURE__ */ new Map(), this.recentlySyncedKeys = /* @__PURE__ */ new Set(), this.hasReceivedFirstCommit = !1, this.isCommittingSyncTransactions = !1, this.commitPendingTransactions = () => {
      let hasPersistingTransaction = !1;
      for (let transaction of this.transactions.values())
        if (transaction.state === "persisting") {
          hasPersistingTransaction = !0;
          break;
        }
      let {
        committedSyncedTransactions,
        uncommittedSyncedTransactions,
        hasTruncateSync
      } = this.pendingSyncedTransactions.reduce(
        (acc, t) => (t.committed ? (acc.committedSyncedTransactions.push(t), t.truncate === !0 && (acc.hasTruncateSync = !0)) : acc.uncommittedSyncedTransactions.push(t), acc),
        {
          committedSyncedTransactions: [],
          uncommittedSyncedTransactions: [],
          hasTruncateSync: !1
        }
      );
      if (!hasPersistingTransaction || hasTruncateSync) {
        this.isCommittingSyncTransactions = !0;
        let truncateOptimisticSnapshot = hasTruncateSync ? committedSyncedTransactions.find((t) => t.truncate)?.optimisticSnapshot : null, changedKeys = /* @__PURE__ */ new Set();
        for (let transaction of committedSyncedTransactions)
          for (let operation of transaction.operations)
            changedKeys.add(operation.key);
        let currentVisibleState = this.preSyncVisibleState;
        if (currentVisibleState.size === 0) {
          currentVisibleState = /* @__PURE__ */ new Map();
          for (let key of changedKeys) {
            let currentValue = this.get(key);
            currentValue !== void 0 && currentVisibleState.set(key, currentValue);
          }
        }
        let events = [], rowUpdateMode = this.config.sync.rowUpdateMode || "partial";
        for (let transaction of committedSyncedTransactions) {
          if (transaction.truncate) {
            let visibleKeys = /* @__PURE__ */ new Set([
              ...this.syncedData.keys(),
              ...truncateOptimisticSnapshot?.upserts.keys() || []
            ]);
            for (let key of visibleKeys) {
              if (truncateOptimisticSnapshot?.deletes.has(key)) continue;
              let previousValue = truncateOptimisticSnapshot?.upserts.get(key) || this.syncedData.get(key);
              previousValue !== void 0 && events.push({ type: "delete", key, value: previousValue });
            }
            this.syncedData.clear(), this.syncedMetadata.clear(), this.syncedKeys.clear();
            for (let key of changedKeys)
              currentVisibleState.delete(key);
          }
          for (let operation of transaction.operations) {
            let key = operation.key;
            switch (this.syncedKeys.add(key), operation.type) {
              case "insert":
                this.syncedMetadata.set(key, operation.metadata);
                break;
              case "update":
                this.syncedMetadata.set(
                  key,
                  Object.assign(
                    {},
                    this.syncedMetadata.get(key),
                    operation.metadata
                  )
                );
                break;
              case "delete":
                this.syncedMetadata.delete(key);
                break;
            }
            switch (operation.type) {
              case "insert":
                this.syncedData.set(key, operation.value);
                break;
              case "update": {
                if (rowUpdateMode === "partial") {
                  let updatedValue = Object.assign(
                    {},
                    this.syncedData.get(key),
                    operation.value
                  );
                  this.syncedData.set(key, updatedValue);
                } else
                  this.syncedData.set(key, operation.value);
                break;
              }
              case "delete":
                this.syncedData.delete(key);
                break;
            }
          }
        }
        if (hasTruncateSync) {
          let syncedInsertedOrUpdatedKeys = /* @__PURE__ */ new Set();
          for (let t of committedSyncedTransactions)
            for (let op of t.operations)
              (op.type === "insert" || op.type === "update") && syncedInsertedOrUpdatedKeys.add(op.key);
          let reapplyUpserts = new Map(
            truncateOptimisticSnapshot.upserts
          ), reapplyDeletes = new Set(
            truncateOptimisticSnapshot.deletes
          );
          for (let [key, value] of reapplyUpserts)
            if (!reapplyDeletes.has(key))
              if (syncedInsertedOrUpdatedKeys.has(key)) {
                let foundInsert = !1;
                for (let i = events.length - 1; i >= 0; i--) {
                  let evt = events[i];
                  if (evt.key === key && evt.type === "insert") {
                    evt.value = value, foundInsert = !0;
                    break;
                  }
                }
                foundInsert || events.push({ type: "insert", key, value });
              } else
                events.push({ type: "insert", key, value });
          if (events.length > 0 && reapplyDeletes.size > 0) {
            let filtered = [];
            for (let evt of events)
              evt.type === "insert" && reapplyDeletes.has(evt.key) || filtered.push(evt);
            events.length = 0, events.push(...filtered);
          }
          this.lifecycle.status !== "ready" && this.lifecycle.markReady();
        }
        if (this.optimisticUpserts.clear(), this.optimisticDeletes.clear(), this.isCommittingSyncTransactions = !1, hasTruncateSync && truncateOptimisticSnapshot) {
          for (let [key, value] of truncateOptimisticSnapshot.upserts)
            this.optimisticUpserts.set(key, value);
          for (let key of truncateOptimisticSnapshot.deletes)
            this.optimisticDeletes.add(key);
        }
        for (let transaction of this.transactions.values())
          if (!["completed", "failed"].includes(transaction.state)) {
            for (let mutation of transaction.mutations)
              if (this.isThisCollection(mutation.collection) && mutation.optimistic)
                switch (mutation.type) {
                  case "insert":
                  case "update":
                    this.optimisticUpserts.set(
                      mutation.key,
                      mutation.modified
                    ), this.optimisticDeletes.delete(mutation.key);
                    break;
                  case "delete":
                    this.optimisticUpserts.delete(mutation.key), this.optimisticDeletes.add(mutation.key);
                    break;
                }
          }
        let completedOptimisticOps = /* @__PURE__ */ new Map();
        for (let transaction of this.transactions.values())
          if (transaction.state === "completed")
            for (let mutation of transaction.mutations)
              mutation.optimistic && this.isThisCollection(mutation.collection) && changedKeys.has(mutation.key) && completedOptimisticOps.set(mutation.key, {
                type: mutation.type,
                value: mutation.modified
              });
        for (let key of changedKeys) {
          let previousVisibleValue = currentVisibleState.get(key), newVisibleValue = this.get(key), completedOp = completedOptimisticOps.get(key), isRedundantSync = !1;
          completedOp && (completedOp.type === "delete" && previousVisibleValue !== void 0 && newVisibleValue === void 0 && deepEquals(completedOp.value, previousVisibleValue) || newVisibleValue !== void 0 && deepEquals(completedOp.value, newVisibleValue)) && (isRedundantSync = !0), isRedundantSync || (previousVisibleValue === void 0 && newVisibleValue !== void 0 ? events.push({
            type: "insert",
            key,
            value: newVisibleValue
          }) : previousVisibleValue !== void 0 && newVisibleValue === void 0 ? events.push({
            type: "delete",
            key,
            value: previousVisibleValue
          }) : previousVisibleValue !== void 0 && newVisibleValue !== void 0 && !deepEquals(previousVisibleValue, newVisibleValue) && events.push({
            type: "update",
            key,
            value: newVisibleValue,
            previousValue: previousVisibleValue
          }));
        }
        this.size = this.calculateSize(), events.length > 0 && this.indexes.updateIndexes(events), this.changes.emitEvents(events, !0), this.pendingSyncedTransactions = uncommittedSyncedTransactions, this.preSyncVisibleState.clear(), Promise.resolve().then(() => {
          this.recentlySyncedKeys.clear();
        }), this.hasReceivedFirstCommit || (this.hasReceivedFirstCommit = !0);
      }
    }, this.config = config, this.transactions = new SortedMap(
      (a, b) => a.compareCreatedAt(b)
    ), config.compare ? this.syncedData = new SortedMap(config.compare) : this.syncedData = /* @__PURE__ */ new Map();
  }
  setDeps(deps) {
    this.collection = deps.collection, this.lifecycle = deps.lifecycle, this.changes = deps.changes, this.indexes = deps.indexes;
  }
  /**
   * Get the current value for a key (virtual derived state)
   */
  get(key) {
    let { optimisticDeletes, optimisticUpserts, syncedData } = this;
    if (!optimisticDeletes.has(key))
      return optimisticUpserts.has(key) ? optimisticUpserts.get(key) : syncedData.get(key);
  }
  /**
   * Check if a key exists in the collection (virtual derived state)
   */
  has(key) {
    let { optimisticDeletes, optimisticUpserts, syncedData } = this;
    return optimisticDeletes.has(key) ? !1 : optimisticUpserts.has(key) ? !0 : syncedData.has(key);
  }
  /**
   * Get all keys (virtual derived state)
   */
  *keys() {
    let { syncedData, optimisticDeletes, optimisticUpserts } = this;
    for (let key of syncedData.keys())
      optimisticDeletes.has(key) || (yield key);
    for (let key of optimisticUpserts.keys())
      !syncedData.has(key) && !optimisticDeletes.has(key) && (yield key);
  }
  /**
   * Get all values (virtual derived state)
   */
  *values() {
    for (let key of this.keys()) {
      let value = this.get(key);
      value !== void 0 && (yield value);
    }
  }
  /**
   * Get all entries (virtual derived state)
   */
  *entries() {
    for (let key of this.keys()) {
      let value = this.get(key);
      value !== void 0 && (yield [key, value]);
    }
  }
  /**
   * Get all entries (virtual derived state)
   */
  *[Symbol.iterator]() {
    for (let [key, value] of this.entries())
      yield [key, value];
  }
  /**
   * Execute a callback for each entry in the collection
   */
  forEach(callbackfn) {
    let index = 0;
    for (let [key, value] of this.entries())
      callbackfn(value, key, index++);
  }
  /**
   * Create a new array with the results of calling a function for each entry in the collection
   */
  map(callbackfn) {
    let result = [], index = 0;
    for (let [key, value] of this.entries())
      result.push(callbackfn(value, key, index++));
    return result;
  }
  /**
   * Check if the given collection is this collection
   * @param collection The collection to check
   * @returns True if the given collection is this collection, false otherwise
   */
  isThisCollection(collection) {
    return collection === this.collection;
  }
  /**
   * Recompute optimistic state from active transactions
   */
  recomputeOptimisticState(triggeredByUserAction = !1) {
    if (this.isCommittingSyncTransactions && !triggeredByUserAction)
      return;
    let previousState = new Map(this.optimisticUpserts), previousDeletes = new Set(this.optimisticDeletes);
    this.optimisticUpserts.clear(), this.optimisticDeletes.clear();
    let activeTransactions = [];
    for (let transaction of this.transactions.values())
      ["completed", "failed"].includes(transaction.state) || activeTransactions.push(transaction);
    for (let transaction of activeTransactions)
      for (let mutation of transaction.mutations)
        if (this.isThisCollection(mutation.collection) && mutation.optimistic)
          switch (mutation.type) {
            case "insert":
            case "update":
              this.optimisticUpserts.set(
                mutation.key,
                mutation.modified
              ), this.optimisticDeletes.delete(mutation.key);
              break;
            case "delete":
              this.optimisticUpserts.delete(mutation.key), this.optimisticDeletes.add(mutation.key);
              break;
          }
    this.size = this.calculateSize();
    let events = [];
    this.collectOptimisticChanges(previousState, previousDeletes, events);
    let filteredEventsBySyncStatus = events.filter((event) => !!(!this.recentlySyncedKeys.has(event.key) || triggeredByUserAction));
    if (this.pendingSyncedTransactions.length > 0 && !triggeredByUserAction) {
      let pendingSyncKeys = /* @__PURE__ */ new Set();
      for (let transaction of this.pendingSyncedTransactions)
        for (let operation of transaction.operations)
          pendingSyncKeys.add(operation.key);
      let filteredEvents = filteredEventsBySyncStatus.filter((event) => !(event.type === "delete" && pendingSyncKeys.has(event.key) && !activeTransactions.some(
        (tx) => tx.mutations.some(
          (m) => this.isThisCollection(m.collection) && m.key === event.key
        )
      )));
      filteredEvents.length > 0 && this.indexes.updateIndexes(filteredEvents), this.changes.emitEvents(filteredEvents, triggeredByUserAction);
    } else
      filteredEventsBySyncStatus.length > 0 && this.indexes.updateIndexes(filteredEventsBySyncStatus), this.changes.emitEvents(filteredEventsBySyncStatus, triggeredByUserAction);
  }
  /**
   * Calculate the current size based on synced data and optimistic changes
   */
  calculateSize() {
    let syncedSize = this.syncedData.size, deletesFromSynced = Array.from(this.optimisticDeletes).filter(
      (key) => this.syncedData.has(key) && !this.optimisticUpserts.has(key)
    ).length, upsertsNotInSynced = Array.from(this.optimisticUpserts.keys()).filter(
      (key) => !this.syncedData.has(key)
    ).length;
    return syncedSize - deletesFromSynced + upsertsNotInSynced;
  }
  /**
   * Collect events for optimistic changes
   */
  collectOptimisticChanges(previousUpserts, previousDeletes, events) {
    let allKeys = /* @__PURE__ */ new Set([
      ...previousUpserts.keys(),
      ...this.optimisticUpserts.keys(),
      ...previousDeletes,
      ...this.optimisticDeletes
    ]);
    for (let key of allKeys) {
      let currentValue = this.get(key), previousValue = this.getPreviousValue(
        key,
        previousUpserts,
        previousDeletes
      );
      previousValue !== void 0 && currentValue === void 0 ? events.push({ type: "delete", key, value: previousValue }) : previousValue === void 0 && currentValue !== void 0 ? events.push({ type: "insert", key, value: currentValue }) : previousValue !== void 0 && currentValue !== void 0 && previousValue !== currentValue && events.push({
        type: "update",
        key,
        value: currentValue,
        previousValue
      });
    }
  }
  /**
   * Get the previous value for a key given previous optimistic state
   */
  getPreviousValue(key, previousUpserts, previousDeletes) {
    if (!previousDeletes.has(key))
      return previousUpserts.has(key) ? previousUpserts.get(key) : this.syncedData.get(key);
  }
  /**
   * Schedule cleanup of a transaction when it completes
   */
  scheduleTransactionCleanup(transaction) {
    if (transaction.state === "completed") {
      this.transactions.delete(transaction.id);
      return;
    }
    transaction.isPersisted.promise.then(() => {
      this.transactions.delete(transaction.id);
    }).catch(() => {
    });
  }
  /**
   * Capture visible state for keys that will be affected by pending sync operations
   * This must be called BEFORE onTransactionStateChange clears optimistic state
   */
  capturePreSyncVisibleState() {
    if (this.pendingSyncedTransactions.length === 0) return;
    let syncedKeys = /* @__PURE__ */ new Set();
    for (let transaction of this.pendingSyncedTransactions)
      for (let operation of transaction.operations)
        syncedKeys.add(operation.key);
    for (let key of syncedKeys)
      this.recentlySyncedKeys.add(key);
    for (let key of syncedKeys)
      if (!this.preSyncVisibleState.has(key)) {
        let currentValue = this.get(key);
        currentValue !== void 0 && this.preSyncVisibleState.set(key, currentValue);
      }
  }
  /**
   * Trigger a recomputation when transactions change
   * This method should be called by the Transaction class when state changes
   */
  onTransactionStateChange() {
    this.changes.shouldBatchEvents = this.pendingSyncedTransactions.length > 0, this.capturePreSyncVisibleState(), this.recomputeOptimisticState(!1);
  }
  /**
   * Clean up the collection by stopping sync and clearing data
   * This can be called manually or automatically by garbage collection
   */
  cleanup() {
    this.syncedData.clear(), this.syncedMetadata.clear(), this.optimisticUpserts.clear(), this.optimisticDeletes.clear(), this.size = 0, this.pendingSyncedTransactions = [], this.syncedKeys.clear(), this.hasReceivedFirstCommit = !1;
  }
};

// packages/db/dist/esm/event-emitter.js
var EventEmitter = class {
  constructor() {
    this.listeners = /* @__PURE__ */ new Map();
  }
  /**
   * Subscribe to an event
   * @param event - Event name to listen for
   * @param callback - Function to call when event is emitted
   * @returns Unsubscribe function
   */
  on(event, callback) {
    return this.listeners.has(event) || this.listeners.set(event, /* @__PURE__ */ new Set()), this.listeners.get(event).add(callback), () => {
      this.listeners.get(event)?.delete(callback);
    };
  }
  /**
   * Subscribe to an event once (automatically unsubscribes after first emission)
   * @param event - Event name to listen for
   * @param callback - Function to call when event is emitted
   * @returns Unsubscribe function
   */
  once(event, callback) {
    let unsubscribe = this.on(event, (eventPayload) => {
      callback(eventPayload), unsubscribe();
    });
    return unsubscribe;
  }
  /**
   * Unsubscribe from an event
   * @param event - Event name to stop listening for
   * @param callback - Function to remove
   */
  off(event, callback) {
    this.listeners.get(event)?.delete(callback);
  }
  /**
   * Wait for an event to be emitted
   * @param event - Event name to wait for
   * @param timeout - Optional timeout in milliseconds
   * @returns Promise that resolves with the event payload
   */
  waitFor(event, timeout) {
    return new Promise((resolve, reject) => {
      let timeoutId, unsubscribe = this.on(event, (eventPayload) => {
        timeoutId && (clearTimeout(timeoutId), timeoutId = void 0), resolve(eventPayload), unsubscribe();
      });
      timeout && (timeoutId = setTimeout(() => {
        timeoutId = void 0, unsubscribe(), reject(new Error(`Timeout waiting for event ${String(event)}`));
      }, timeout));
    });
  }
  /**
   * Emit an event to all listeners
   * @param event - Event name to emit
   * @param eventPayload - Event payload
   * @internal For use by subclasses - subclasses should wrap this with a public emit if needed
   */
  emitInner(event, eventPayload) {
    this.listeners.get(event)?.forEach((listener) => {
      try {
        listener(eventPayload);
      } catch (error) {
        queueMicrotask(() => {
          throw error;
        });
      }
    });
  }
  /**
   * Clear all listeners
   */
  clearListeners() {
    this.listeners.clear();
  }
};

// packages/db/dist/esm/collection/subscription.js
var CollectionSubscription = class extends EventEmitter {
  constructor(collection, callback, options) {
    super(), this.collection = collection, this.callback = callback, this.options = options, this.loadedInitialState = !1, this.snapshotSent = !1, this.sentKeys = /* @__PURE__ */ new Set(), this._status = "ready", this.pendingLoadSubsetPromises = /* @__PURE__ */ new Set(), options.onUnsubscribe && this.on("unsubscribed", (event) => options.onUnsubscribe(event)), options.whereExpression && ensureIndexForExpression(options.whereExpression, this.collection);
    let callbackWithSentKeysTracking = (changes) => {
      callback(changes), this.trackSentKeys(changes);
    };
    this.callback = callbackWithSentKeysTracking, this.filteredCallback = options.whereExpression ? createFilteredCallback(this.callback, options) : this.callback;
  }
  get status() {
    return this._status;
  }
  setOrderByIndex(index) {
    this.orderByIndex = index;
  }
  /**
   * Set subscription status and emit events if changed
   */
  setStatus(newStatus) {
    if (this._status === newStatus)
      return;
    let previousStatus = this._status;
    this._status = newStatus, this.emitInner("status:change", {
      type: "status:change",
      subscription: this,
      previousStatus,
      status: newStatus
    });
    let eventKey = `status:${newStatus}`;
    this.emitInner(eventKey, {
      type: eventKey,
      subscription: this,
      previousStatus,
      status: newStatus
    });
  }
  /**
   * Track a loadSubset promise and manage loading status
   */
  trackLoadSubsetPromise(syncResult) {
    syncResult instanceof Promise && (this.pendingLoadSubsetPromises.add(syncResult), this.setStatus("loadingSubset"), syncResult.finally(() => {
      this.pendingLoadSubsetPromises.delete(syncResult), this.pendingLoadSubsetPromises.size === 0 && this.setStatus("ready");
    }));
  }
  hasLoadedInitialState() {
    return this.loadedInitialState;
  }
  hasSentAtLeastOneSnapshot() {
    return this.snapshotSent;
  }
  emitEvents(changes) {
    let newChanges = this.filterAndFlipChanges(changes);
    this.filteredCallback(newChanges);
  }
  /**
   * Sends the snapshot to the callback.
   * Returns a boolean indicating if it succeeded.
   * It can only fail if there is no index to fulfill the request
   * and the optimizedOnly option is set to true,
   * or, the entire state was already loaded.
   */
  requestSnapshot(opts) {
    if (this.loadedInitialState)
      return !1;
    let stateOpts = {
      where: this.options.whereExpression,
      optimizedOnly: opts?.optimizedOnly ?? !1
    };
    if (opts) {
      if ("where" in opts) {
        let snapshotWhereExp = opts.where;
        if (stateOpts.where) {
          let subWhereExp = stateOpts.where, combinedWhereExp = and(subWhereExp, snapshotWhereExp);
          stateOpts.where = combinedWhereExp;
        } else
          stateOpts.where = snapshotWhereExp;
      }
    } else
      this.loadedInitialState = !0;
    let syncResult = this.collection._sync.loadSubset({
      where: stateOpts.where,
      subscription: this
    });
    this.trackLoadSubsetPromise(syncResult);
    let snapshot = this.collection.currentStateAsChanges(stateOpts);
    if (snapshot === void 0)
      return !1;
    let filteredSnapshot = snapshot.filter(
      (change) => !this.sentKeys.has(change.key)
    );
    return this.snapshotSent = !0, this.callback(filteredSnapshot), !0;
  }
  /**
   * Sends a snapshot that is limited to the first `limit` rows that fulfill the `where` clause and are bigger than `minValue`.
   * Requires a range index to be set with `setOrderByIndex` prior to calling this method.
   * It uses that range index to load the items in the order of the index.
   * Note: it does not send keys that have already been sent before.
   */
  requestLimitedSnapshot({
    orderBy,
    limit,
    minValue
  }) {
    if (!limit) throw new Error("limit is required");
    if (!this.orderByIndex)
      throw new Error(
        "Ordered snapshot was requested but no index was found. You have to call setOrderByIndex before requesting an ordered snapshot."
      );
    let index = this.orderByIndex, where = this.options.whereExpression, whereFilterFn = where ? createFilterFunctionFromExpression(where) : void 0, filterFn = (key) => {
      if (this.sentKeys.has(key))
        return !1;
      let value = this.collection.get(key);
      return value === void 0 ? !1 : whereFilterFn?.(value) ?? !0;
    }, biggestObservedValue = minValue, changes = [], keys = index.take(limit, minValue, filterFn), valuesNeeded = () => Math.max(limit - changes.length, 0), collectionExhausted = () => keys.length === 0;
    for (; valuesNeeded() > 0 && !collectionExhausted(); ) {
      for (let key of keys) {
        let value = this.collection.get(key);
        changes.push({
          type: "insert",
          key,
          value
        }), biggestObservedValue = value;
      }
      keys = index.take(valuesNeeded(), biggestObservedValue, filterFn);
    }
    this.callback(changes);
    let whereWithValueFilter = where;
    if (typeof minValue < "u") {
      let { expression, compareOptions } = orderBy[0], valueFilter = (compareOptions.direction === "asc" ? gt : lt)(expression, new Value(minValue));
      whereWithValueFilter = where ? and(where, valueFilter) : valueFilter;
    }
    let syncResult = this.collection._sync.loadSubset({
      where: whereWithValueFilter,
      limit,
      orderBy,
      subscription: this
    });
    this.trackLoadSubsetPromise(syncResult);
  }
  /**
   * Filters and flips changes for keys that have not been sent yet.
   * Deletes are filtered out for keys that have not been sent yet.
   * Updates are flipped into inserts for keys that have not been sent yet.
   */
  filterAndFlipChanges(changes) {
    if (this.loadedInitialState)
      return changes;
    let newChanges = [];
    for (let change of changes) {
      let newChange = change;
      if (!this.sentKeys.has(change.key)) {
        if (change.type === "update")
          newChange = { ...change, type: "insert", previousValue: void 0 };
        else if (change.type === "delete")
          continue;
        this.sentKeys.add(change.key);
      }
      newChanges.push(newChange);
    }
    return newChanges;
  }
  trackSentKeys(changes) {
    if (!this.loadedInitialState)
      for (let change of changes)
        this.sentKeys.add(change.key);
  }
  unsubscribe() {
    this.emitInner("unsubscribed", {
      type: "unsubscribed",
      subscription: this
    }), this.clearListeners();
  }
};

// packages/db/dist/esm/collection/changes.js
var CollectionChangesManager = class {
  /**
   * Creates a new CollectionChangesManager instance
   */
  constructor() {
    this.activeSubscribersCount = 0, this.changeSubscriptions = /* @__PURE__ */ new Set(), this.batchedEvents = [], this.shouldBatchEvents = !1;
  }
  setDeps(deps) {
    this.lifecycle = deps.lifecycle, this.sync = deps.sync, this.events = deps.events, this.collection = deps.collection;
  }
  /**
   * Emit an empty ready event to notify subscribers that the collection is ready
   * This bypasses the normal empty array check in emitEvents
   */
  emitEmptyReadyEvent() {
    for (let subscription of this.changeSubscriptions)
      subscription.emitEvents([]);
  }
  /**
   * Emit events either immediately or batch them for later emission
   */
  emitEvents(changes, forceEmit = !1) {
    if (this.shouldBatchEvents && !forceEmit) {
      this.batchedEvents.push(...changes);
      return;
    }
    let eventsToEmit = changes;
    if (forceEmit && (this.batchedEvents.length > 0 && (eventsToEmit = [...this.batchedEvents, ...changes]), this.batchedEvents = [], this.shouldBatchEvents = !1), eventsToEmit.length !== 0)
      for (let subscription of this.changeSubscriptions)
        subscription.emitEvents(eventsToEmit);
  }
  /**
   * Subscribe to changes in the collection
   */
  subscribeChanges(callback, options = {}) {
    this.addSubscriber();
    let subscription = new CollectionSubscription(this.collection, callback, {
      ...options,
      onUnsubscribe: () => {
        this.removeSubscriber(), this.changeSubscriptions.delete(subscription);
      }
    });
    return options.includeInitialState && subscription.requestSnapshot(), this.changeSubscriptions.add(subscription), subscription;
  }
  /**
   * Increment the active subscribers count and start sync if needed
   */
  addSubscriber() {
    let previousSubscriberCount = this.activeSubscribersCount;
    this.activeSubscribersCount++, this.lifecycle.cancelGCTimer(), (this.lifecycle.status === "cleaned-up" || this.lifecycle.status === "idle") && this.sync.startSync(), this.events.emitSubscribersChange(
      this.activeSubscribersCount,
      previousSubscriberCount
    );
  }
  /**
   * Decrement the active subscribers count and start GC timer if needed
   */
  removeSubscriber() {
    let previousSubscriberCount = this.activeSubscribersCount;
    if (this.activeSubscribersCount--, this.activeSubscribersCount === 0)
      this.lifecycle.startGCTimer();
    else if (this.activeSubscribersCount < 0)
      throw new NegativeActiveSubscribersError();
    this.events.emitSubscribersChange(
      this.activeSubscribersCount,
      previousSubscriberCount
    );
  }
  /**
   * Clean up the collection by stopping sync and clearing data
   * This can be called manually or automatically by garbage collection
   */
  cleanup() {
    this.batchedEvents = [], this.shouldBatchEvents = !1;
  }
};

// packages/db/dist/esm/utils/browser-polyfills.js
var requestIdleCallbackPolyfill = (callback) => setTimeout(() => {
  callback({
    didTimeout: !0,
    // Always indicate timeout for the polyfill
    timeRemaining: () => 50
    // Return some time remaining for polyfill
  });
}, 0), cancelIdleCallbackPolyfill = (id) => {
  clearTimeout(id);
}, safeRequestIdleCallback = typeof window < "u" && "requestIdleCallback" in window ? (callback, options) => window.requestIdleCallback(callback, options) : (callback, _options) => requestIdleCallbackPolyfill(callback), safeCancelIdleCallback = typeof window < "u" && "cancelIdleCallback" in window ? (id) => window.cancelIdleCallback(id) : cancelIdleCallbackPolyfill;

// packages/db/dist/esm/collection/lifecycle.js
var CollectionLifecycleManager = class {
  /**
   * Creates a new CollectionLifecycleManager instance
   */
  constructor(config, id) {
    this.status = "idle", this.hasBeenReady = !1, this.hasReceivedFirstCommit = !1, this.onFirstReadyCallbacks = [], this.gcTimeoutId = null, this.idleCallbackId = null, this.config = config, this.id = id;
  }
  setDeps(deps) {
    this.indexes = deps.indexes, this.events = deps.events, this.changes = deps.changes, this.sync = deps.sync, this.state = deps.state;
  }
  /**
   * Validates state transitions to prevent invalid status changes
   */
  validateStatusTransition(from, to) {
    if (from === to)
      return;
    if (!{
      idle: ["loading", "error", "cleaned-up"],
      loading: ["ready", "error", "cleaned-up"],
      ready: ["cleaned-up", "error"],
      error: ["cleaned-up", "idle"],
      "cleaned-up": ["loading", "error"]
    }[from].includes(to))
      throw new InvalidCollectionStatusTransitionError(from, to, this.id);
  }
  /**
   * Safely update the collection status with validation
   * @private
   */
  setStatus(newStatus, allowReady = !1) {
    if (newStatus === "ready" && !allowReady)
      throw new CollectionStateError(
        `You can't directly call "setStatus('ready'). You must use markReady instead.`
      );
    this.validateStatusTransition(this.status, newStatus);
    let previousStatus = this.status;
    this.status = newStatus, newStatus === "ready" && !this.indexes.isIndexesResolved && this.indexes.resolveAllIndexes().catch((error) => {
      console.warn(
        `${this.config.id ? `[${this.config.id}] ` : ""}Failed to resolve indexes:`,
        error
      );
    }), this.events.emitStatusChange(newStatus, previousStatus);
  }
  /**
   * Validates that the collection is in a usable state for data operations
   * @private
   */
  validateCollectionUsable(operation) {
    switch (this.status) {
      case "error":
        throw new CollectionInErrorStateError(operation, this.id);
      case "cleaned-up":
        this.sync.startSync();
        break;
    }
  }
  /**
   * Mark the collection as ready for use
   * This is called by sync implementations to explicitly signal that the collection is ready,
   * providing a more intuitive alternative to using commits for readiness signaling
   * @private - Should only be called by sync implementations
   */
  markReady() {
    if (this.validateStatusTransition(this.status, "ready"), this.status === "loading") {
      if (this.setStatus("ready", !0), !this.hasBeenReady) {
        this.hasBeenReady = !0, this.hasReceivedFirstCommit || (this.hasReceivedFirstCommit = !0);
        let callbacks = [...this.onFirstReadyCallbacks];
        this.onFirstReadyCallbacks = [], callbacks.forEach((callback) => callback());
      }
      this.changes.changeSubscriptions.size > 0 && this.changes.emitEmptyReadyEvent();
    }
  }
  /**
   * Start the garbage collection timer
   * Called when the collection becomes inactive (no subscribers)
   */
  startGCTimer() {
    this.gcTimeoutId && clearTimeout(this.gcTimeoutId);
    let gcTime = this.config.gcTime ?? 3e5;
    gcTime !== 0 && (this.gcTimeoutId = setTimeout(() => {
      this.changes.activeSubscribersCount === 0 && this.scheduleIdleCleanup();
    }, gcTime));
  }
  /**
   * Cancel the garbage collection timer
   * Called when the collection becomes active again
   */
  cancelGCTimer() {
    this.gcTimeoutId && (clearTimeout(this.gcTimeoutId), this.gcTimeoutId = null), this.idleCallbackId !== null && (safeCancelIdleCallback(this.idleCallbackId), this.idleCallbackId = null);
  }
  /**
   * Schedule cleanup to run during browser idle time
   * This prevents blocking the UI thread during cleanup operations
   */
  scheduleIdleCleanup() {
    this.idleCallbackId !== null && safeCancelIdleCallback(this.idleCallbackId), this.idleCallbackId = safeRequestIdleCallback(
      (deadline) => {
        this.changes.activeSubscribersCount === 0 ? this.performCleanup(deadline) && (this.idleCallbackId = null) : this.idleCallbackId = null;
      },
      { timeout: 1e3 }
    );
  }
  /**
   * Perform cleanup operations, optionally in chunks during idle time
   * @returns true if cleanup was completed, false if it was rescheduled
   */
  performCleanup(deadline) {
    return !deadline || deadline.timeRemaining() > 0 || deadline.didTimeout ? (this.sync.cleanup(), this.state.cleanup(), this.changes.cleanup(), this.indexes.cleanup(), this.gcTimeoutId && (clearTimeout(this.gcTimeoutId), this.gcTimeoutId = null), this.hasBeenReady = !1, this.onFirstReadyCallbacks = [], this.setStatus("cleaned-up"), this.events.cleanup(), !0) : (this.scheduleIdleCleanup(), !1);
  }
  /**
   * Register a callback to be executed when the collection first becomes ready
   * Useful for preloading collections
   * @param callback Function to call when the collection first becomes ready
   */
  onFirstReady(callback) {
    if (this.hasBeenReady) {
      callback();
      return;
    }
    this.onFirstReadyCallbacks.push(callback);
  }
  cleanup() {
    this.idleCallbackId !== null && (safeCancelIdleCallback(this.idleCallbackId), this.idleCallbackId = null), this.performCleanup();
  }
};

// packages/db/dist/esm/collection/sync.js
var CollectionSyncManager = class {
  /**
   * Creates a new CollectionSyncManager instance
   */
  constructor(config, id) {
    this.preloadPromise = null, this.syncCleanupFn = null, this.syncLoadSubsetFn = null, this.pendingLoadSubsetPromises = /* @__PURE__ */ new Set(), this.config = config, this.id = id, this.syncMode = config.syncMode ?? "eager";
  }
  setDeps(deps) {
    this.collection = deps.collection, this.state = deps.state, this.lifecycle = deps.lifecycle, this._events = deps.events;
  }
  /**
   * Start the sync process for this collection
   * This is called when the collection is first accessed or preloaded
   */
  startSync() {
    if (!(this.lifecycle.status !== "idle" && this.lifecycle.status !== "cleaned-up")) {
      this.lifecycle.setStatus("loading");
      try {
        let syncRes = normalizeSyncFnResult(
          this.config.sync.sync({
            collection: this.collection,
            begin: () => {
              this.state.pendingSyncedTransactions.push({
                committed: !1,
                operations: [],
                deletedKeys: /* @__PURE__ */ new Set()
              });
            },
            write: (messageWithoutKey) => {
              let pendingTransaction = this.state.pendingSyncedTransactions[this.state.pendingSyncedTransactions.length - 1];
              if (!pendingTransaction)
                throw new NoPendingSyncTransactionWriteError();
              if (pendingTransaction.committed)
                throw new SyncTransactionAlreadyCommittedWriteError();
              let key = this.config.getKey(messageWithoutKey.value), messageType = messageWithoutKey.type;
              if (messageWithoutKey.type === "insert") {
                let insertingIntoExistingSynced = this.state.syncedData.has(key), hasPendingDeleteForKey = pendingTransaction.deletedKeys.has(key), isTruncateTransaction = pendingTransaction.truncate === !0;
                if (insertingIntoExistingSynced && !hasPendingDeleteForKey && !isTruncateTransaction) {
                  let existingValue = this.state.syncedData.get(key);
                  if (existingValue !== void 0 && deepEquals(existingValue, messageWithoutKey.value))
                    messageType = "update";
                  else
                    throw new DuplicateKeySyncError(key, this.id);
                }
              }
              let message = {
                ...messageWithoutKey,
                type: messageType,
                key
              };
              pendingTransaction.operations.push(message), messageType === "delete" && pendingTransaction.deletedKeys.add(key);
            },
            commit: () => {
              let pendingTransaction = this.state.pendingSyncedTransactions[this.state.pendingSyncedTransactions.length - 1];
              if (!pendingTransaction)
                throw new NoPendingSyncTransactionCommitError();
              if (pendingTransaction.committed)
                throw new SyncTransactionAlreadyCommittedError();
              pendingTransaction.committed = !0, this.state.commitPendingTransactions();
            },
            markReady: () => {
              this.lifecycle.markReady();
            },
            truncate: () => {
              let pendingTransaction = this.state.pendingSyncedTransactions[this.state.pendingSyncedTransactions.length - 1];
              if (!pendingTransaction)
                throw new NoPendingSyncTransactionWriteError();
              if (pendingTransaction.committed)
                throw new SyncTransactionAlreadyCommittedWriteError();
              pendingTransaction.operations = [], pendingTransaction.deletedKeys.clear(), pendingTransaction.truncate = !0, pendingTransaction.optimisticSnapshot = {
                upserts: new Map(this.state.optimisticUpserts),
                deletes: new Set(this.state.optimisticDeletes)
              };
            }
          })
        );
        if (this.syncCleanupFn = syncRes?.cleanup ?? null, this.syncLoadSubsetFn = syncRes?.loadSubset ?? null, this.syncMode === "on-demand" && !this.syncLoadSubsetFn)
          throw new CollectionConfigurationError(
            `Collection "${this.id}" is configured with syncMode "on-demand" but the sync function did not return a loadSubset handler. Either provide a loadSubset handler or use syncMode "eager".`
          );
      } catch (error) {
        throw this.lifecycle.setStatus("error"), error;
      }
    }
  }
  /**
   * Preload the collection data by starting sync if not already started
   * Multiple concurrent calls will share the same promise
   */
  preload() {
    return this.preloadPromise ? this.preloadPromise : (this.preloadPromise = new Promise((resolve, reject) => {
      if (this.lifecycle.status === "ready") {
        resolve();
        return;
      }
      if (this.lifecycle.status === "error") {
        reject(new CollectionIsInErrorStateError());
        return;
      }
      if (this.lifecycle.onFirstReady(() => {
        resolve();
      }), this.lifecycle.status === "idle" || this.lifecycle.status === "cleaned-up")
        try {
          this.startSync();
        } catch (error) {
          reject(error);
          return;
        }
    }), this.preloadPromise);
  }
  /**
   * Gets whether the collection is currently loading more data
   */
  get isLoadingSubset() {
    return this.pendingLoadSubsetPromises.size > 0;
  }
  /**
   * Tracks a load promise for isLoadingSubset state.
   * @internal This is for internal coordination (e.g., live-query glue code), not for general use.
   */
  trackLoadPromise(promise) {
    let loadingStarting = !this.isLoadingSubset;
    this.pendingLoadSubsetPromises.add(promise), loadingStarting && this._events.emit("loadingSubset:change", {
      type: "loadingSubset:change",
      collection: this.collection,
      isLoadingSubset: !0,
      previousIsLoadingSubset: !1,
      loadingSubsetTransition: "start"
    }), promise.finally(() => {
      let loadingEnding = this.pendingLoadSubsetPromises.size === 1 && this.pendingLoadSubsetPromises.has(promise);
      this.pendingLoadSubsetPromises.delete(promise), loadingEnding && this._events.emit("loadingSubset:change", {
        type: "loadingSubset:change",
        collection: this.collection,
        isLoadingSubset: !1,
        previousIsLoadingSubset: !0,
        loadingSubsetTransition: "end"
      });
    });
  }
  /**
   * Requests the sync layer to load more data.
   * @param options Options to control what data is being loaded
   * @returns If data loading is asynchronous, this method returns a promise that resolves when the data is loaded.
   *          Returns true if no sync function is configured, if syncMode is 'eager', or if there is no work to do.
   */
  loadSubset(options) {
    if (this.syncMode === "eager")
      return !0;
    if (this.syncLoadSubsetFn) {
      let result = this.syncLoadSubsetFn(options);
      if (result instanceof Promise)
        return this.trackLoadPromise(result), result;
    }
    return !0;
  }
  cleanup() {
    try {
      this.syncCleanupFn && (this.syncCleanupFn(), this.syncCleanupFn = null);
    } catch (error) {
      queueMicrotask(() => {
        if (error instanceof Error) {
          let wrappedError = new SyncCleanupError(this.id, error);
          throw wrappedError.cause = error, wrappedError.stack = error.stack, wrappedError;
        } else
          throw new SyncCleanupError(this.id, error);
      });
    }
    this.preloadPromise = null;
  }
};
function normalizeSyncFnResult(result) {
  if (typeof result == "function")
    return { cleanup: result };
  if (typeof result == "object")
    return result;
}

// packages/db/dist/esm/indexes/lazy-index.js
function isConstructor(resolver) {
  return typeof resolver == "function" && resolver.prototype !== void 0 && resolver.prototype.constructor === resolver;
}
async function resolveIndexConstructor(resolver) {
  return isConstructor(resolver) ? resolver : await resolver();
}
var LazyIndexWrapper = class {
  constructor(id, expression, name, resolver, options, collectionEntries) {
    this.id = id, this.expression = expression, this.name = name, this.resolver = resolver, this.options = options, this.collectionEntries = collectionEntries, this.indexPromise = null, this.resolvedIndex = null, isConstructor(this.resolver) && (this.resolvedIndex = new this.resolver(
      this.id,
      this.expression,
      this.name,
      this.options
    ), this.collectionEntries && this.resolvedIndex.build(this.collectionEntries));
  }
  /**
   * Resolve the actual index
   */
  async resolve() {
    return this.resolvedIndex ? this.resolvedIndex : (this.indexPromise || (this.indexPromise = this.createIndex()), this.resolvedIndex = await this.indexPromise, this.resolvedIndex);
  }
  /**
   * Check if already resolved
   */
  isResolved() {
    return this.resolvedIndex !== null;
  }
  /**
   * Get resolved index (throws if not ready)
   */
  getResolved() {
    if (!this.resolvedIndex)
      throw new Error(
        `Index ${this.id} has not been resolved yet. Ensure collection is synced.`
      );
    return this.resolvedIndex;
  }
  /**
   * Get the index ID
   */
  getId() {
    return this.id;
  }
  /**
   * Get the index name
   */
  getName() {
    return this.name;
  }
  /**
   * Get the index expression
   */
  getExpression() {
    return this.expression;
  }
  async createIndex() {
    let IndexClass = await resolveIndexConstructor(this.resolver);
    return new IndexClass(this.id, this.expression, this.name, this.options);
  }
}, IndexProxy = class {
  constructor(indexId, lazyIndex) {
    this.indexId = indexId, this.lazyIndex = lazyIndex;
  }
  /**
   * Get the resolved index (throws if not ready)
   */
  get index() {
    return this.lazyIndex.getResolved();
  }
  /**
   * Check if index is ready
   */
  get isReady() {
    return this.lazyIndex.isResolved();
  }
  /**
   * Wait for index to be ready
   */
  async whenReady() {
    return await this.lazyIndex.resolve();
  }
  /**
   * Get the index ID
   */
  get id() {
    return this.indexId;
  }
  /**
   * Get the index name (throws if not ready)
   */
  get name() {
    return this.isReady ? this.index.name : this.lazyIndex.getName();
  }
  /**
   * Get the index expression (available immediately)
   */
  get expression() {
    return this.lazyIndex.getExpression();
  }
  /**
   * Check if index supports an operation (throws if not ready)
   */
  supports(operation) {
    return this.index.supports(operation);
  }
  /**
   * Get index statistics (throws if not ready)
   */
  getStats() {
    return this.index.getStats();
  }
  /**
   * Check if index matches a field path (available immediately)
   */
  matchesField(fieldPath) {
    let expr = this.expression;
    return expr.type === "ref" && expr.path.length === fieldPath.length && expr.path.every((part, i) => part === fieldPath[i]);
  }
  /**
   * Get the key count (throws if not ready)
   */
  get keyCount() {
    return this.index.keyCount;
  }
  // Test compatibility properties - delegate to resolved index
  get indexedKeysSet() {
    return this.index.indexedKeysSet;
  }
  get orderedEntriesArray() {
    return this.index.orderedEntriesArray;
  }
  get valueMapData() {
    return this.index.valueMapData;
  }
  // BTreeIndex compatibility methods
  equalityLookup(value) {
    return this.index.equalityLookup?.(value) ?? /* @__PURE__ */ new Set();
  }
  rangeQuery(options) {
    return this.index.rangeQuery?.(options) ?? /* @__PURE__ */ new Set();
  }
  inArrayLookup(values) {
    return this.index.inArrayLookup?.(values) ?? /* @__PURE__ */ new Set();
  }
  // Internal method for the collection to get the lazy wrapper
  _getLazyWrapper() {
    return this.lazyIndex;
  }
};

// packages/db/dist/esm/collection/indexes.js
var CollectionIndexesManager = class {
  constructor() {
    this.lazyIndexes = /* @__PURE__ */ new Map(), this.resolvedIndexes = /* @__PURE__ */ new Map(), this.isIndexesResolved = !1, this.indexCounter = 0;
  }
  setDeps(deps) {
    this.state = deps.state, this.lifecycle = deps.lifecycle;
  }
  /**
   * Creates an index on a collection for faster queries.
   */
  createIndex(indexCallback, config = {}) {
    this.lifecycle.validateCollectionUsable("createIndex");
    let indexId = ++this.indexCounter, singleRowRefProxy = createSingleRowRefProxy(), indexExpression = indexCallback(singleRowRefProxy), expression = toExpression(indexExpression), resolver = config.indexType ?? BTreeIndex, lazyIndex = new LazyIndexWrapper(
      indexId,
      expression,
      config.name,
      resolver,
      config.options,
      this.state.entries()
    );
    if (this.lazyIndexes.set(indexId, lazyIndex), resolver === BTreeIndex)
      try {
        let resolvedIndex = lazyIndex.getResolved();
        this.resolvedIndexes.set(indexId, resolvedIndex);
      } catch (error) {
        console.warn("Failed to resolve BTreeIndex:", error);
      }
    else if (typeof resolver == "function" && resolver.prototype)
      try {
        let resolvedIndex = lazyIndex.getResolved();
        this.resolvedIndexes.set(indexId, resolvedIndex);
      } catch {
        this.resolveSingleIndex(indexId, lazyIndex).catch((error) => {
          console.warn("Failed to resolve single index:", error);
        });
      }
    else this.isIndexesResolved && this.resolveSingleIndex(indexId, lazyIndex).catch((error) => {
      console.warn("Failed to resolve single index:", error);
    });
    return new IndexProxy(indexId, lazyIndex);
  }
  /**
   * Resolve all lazy indexes (called when collection first syncs)
   */
  async resolveAllIndexes() {
    if (this.isIndexesResolved) return;
    let resolutionPromises = Array.from(this.lazyIndexes.entries()).map(
      async ([indexId, lazyIndex]) => {
        let resolvedIndex = await lazyIndex.resolve();
        return resolvedIndex.build(this.state.entries()), this.resolvedIndexes.set(indexId, resolvedIndex), { indexId, resolvedIndex };
      }
    );
    await Promise.all(resolutionPromises), this.isIndexesResolved = !0;
  }
  /**
   * Resolve a single index immediately
   */
  async resolveSingleIndex(indexId, lazyIndex) {
    let resolvedIndex = await lazyIndex.resolve();
    return resolvedIndex.build(this.state.entries()), this.resolvedIndexes.set(indexId, resolvedIndex), resolvedIndex;
  }
  /**
   * Get resolved indexes for query optimization
   */
  get indexes() {
    return this.resolvedIndexes;
  }
  /**
   * Updates all indexes when the collection changes
   */
  updateIndexes(changes) {
    for (let index of this.resolvedIndexes.values())
      for (let change of changes)
        switch (change.type) {
          case "insert":
            index.add(change.key, change.value);
            break;
          case "update":
            change.previousValue ? index.update(change.key, change.previousValue, change.value) : index.add(change.key, change.value);
            break;
          case "delete":
            index.remove(change.key, change.value);
            break;
        }
  }
  /**
   * Clean up the collection by stopping sync and clearing data
   * This can be called manually or automatically by garbage collection
   */
  cleanup() {
    this.lazyIndexes.clear(), this.resolvedIndexes.clear();
  }
};

// packages/db/dist/esm/proxy.js
function debugLog(...args) {
  let isBrowser = typeof window < "u" && typeof localStorage < "u";
  isBrowser && localStorage.getItem("DEBUG") === "true" ? console.log("[proxy]", ...args) : (
    // true
    !isBrowser && typeof process < "u" && process.env.DEBUG === "true" && console.log("[proxy]", ...args)
  );
}
function deepClone(obj, visited = /* @__PURE__ */ new WeakMap()) {
  if (obj == null || typeof obj != "object")
    return obj;
  if (visited.has(obj))
    return visited.get(obj);
  if (obj instanceof Date)
    return new Date(obj.getTime());
  if (obj instanceof RegExp)
    return new RegExp(obj.source, obj.flags);
  if (Array.isArray(obj)) {
    let arrayClone = [];
    return visited.set(obj, arrayClone), obj.forEach((item, index) => {
      arrayClone[index] = deepClone(item, visited);
    }), arrayClone;
  }
  if (ArrayBuffer.isView(obj) && !(obj instanceof DataView)) {
    let TypedArrayConstructor = Object.getPrototypeOf(obj).constructor, clone2 = new TypedArrayConstructor(
      obj.length
    );
    visited.set(obj, clone2);
    for (let i = 0; i < obj.length; i++)
      clone2[i] = obj[i];
    return clone2;
  }
  if (obj instanceof Map) {
    let clone2 = /* @__PURE__ */ new Map();
    return visited.set(obj, clone2), obj.forEach((value, key) => {
      clone2.set(key, deepClone(value, visited));
    }), clone2;
  }
  if (obj instanceof Set) {
    let clone2 = /* @__PURE__ */ new Set();
    return visited.set(obj, clone2), obj.forEach((value) => {
      clone2.add(deepClone(value, visited));
    }), clone2;
  }
  if (isTemporal(obj))
    return obj;
  let clone = {};
  visited.set(obj, clone);
  for (let key in obj)
    Object.prototype.hasOwnProperty.call(obj, key) && (clone[key] = deepClone(
      obj[key],
      visited
    ));
  let symbolProps = Object.getOwnPropertySymbols(obj);
  for (let sym of symbolProps)
    clone[sym] = deepClone(
      obj[sym],
      visited
    );
  return clone;
}
var count = 0;
function getProxyCount() {
  return count += 1, count;
}
function createChangeProxy(target, parent) {
  let changeProxyCache = /* @__PURE__ */ new Map();
  function memoizedCreateChangeProxy(innerTarget, innerParent) {
    if (debugLog("Object ID:", innerTarget.constructor.name), changeProxyCache.has(innerTarget))
      return changeProxyCache.get(innerTarget);
    {
      let changeProxy = createChangeProxy(innerTarget, innerParent);
      return changeProxyCache.set(innerTarget, changeProxy), changeProxy;
    }
  }
  let proxyCache = /* @__PURE__ */ new Map(), changeTracker = {
    copy_: deepClone(target),
    originalObject: deepClone(target),
    proxyCount: getProxyCount(),
    modified: !1,
    assigned_: {},
    parent,
    target
    // Store reference to the target object
  };
  debugLog(
    "createChangeProxy called for target",
    target,
    changeTracker.proxyCount
  );
  function markChanged(state) {
    state.modified || (state.modified = !0), state.parent && (debugLog("propagating change to parent"), "updateMap" in state.parent ? state.parent.updateMap(state.copy_) : "updateSet" in state.parent ? state.parent.updateSet(state.copy_) : (state.parent.tracker.copy_[state.parent.prop] = state.copy_, state.parent.tracker.assigned_[state.parent.prop] = !0), markChanged(state.parent.tracker));
  }
  function checkIfReverted(state) {
    if (debugLog(
      "checkIfReverted called with assigned keys:",
      Object.keys(state.assigned_)
    ), Object.keys(state.assigned_).length === 0 && Object.getOwnPropertySymbols(state.assigned_).length === 0)
      return debugLog("No assigned properties, returning true"), !0;
    for (let prop in state.assigned_)
      if (state.assigned_[prop] === !0) {
        let currentValue = state.copy_[prop], originalValue = state.originalObject[prop];
        if (debugLog(
          `Checking property ${String(prop)}, current:`,
          currentValue,
          "original:",
          originalValue
        ), !deepEquals(currentValue, originalValue))
          return debugLog(`Property ${String(prop)} is different, returning false`), !1;
      } else if (state.assigned_[prop] === !1)
        return debugLog(`Property ${String(prop)} was deleted, returning false`), !1;
    let symbolProps = Object.getOwnPropertySymbols(state.assigned_);
    for (let sym of symbolProps)
      if (state.assigned_[sym] === !0) {
        let currentValue = state.copy_[sym], originalValue = state.originalObject[sym];
        if (!deepEquals(currentValue, originalValue))
          return debugLog("Symbol property is different, returning false"), !1;
      } else if (state.assigned_[sym] === !1)
        return debugLog("Symbol property was deleted, returning false"), !1;
    return debugLog("All properties match original values, returning true"), !0;
  }
  function checkParentStatus(parentState, childProp) {
    debugLog("checkParentStatus called for child prop:", childProp);
    let isReverted = checkIfReverted(parentState);
    debugLog("Parent checkIfReverted returned:", isReverted), isReverted && (debugLog("Parent is fully reverted, clearing tracking"), parentState.modified = !1, parentState.assigned_ = {}, parentState.parent && (debugLog("Continuing up the parent chain"), checkParentStatus(parentState.parent.tracker, parentState.parent.prop)));
  }
  function createObjectProxy(obj) {
    if (debugLog("createObjectProxy", obj), proxyCache.has(obj))
      return debugLog("proxyCache found match"), proxyCache.get(obj);
    let proxy2 = new Proxy(obj, {
      get(ptarget, prop) {
        debugLog("get", ptarget, prop);
        let value = changeTracker.copy_[prop] ?? changeTracker.originalObject[prop], originalValue = changeTracker.originalObject[prop];
        if (debugLog("value (at top of proxy get)", value), Object.getOwnPropertyDescriptor(ptarget, prop)?.get)
          return value;
        if (typeof value == "function") {
          if (Array.isArray(ptarget)) {
            let methodName = prop.toString();
            if ((/* @__PURE__ */ new Set([
              "pop",
              "push",
              "shift",
              "unshift",
              "splice",
              "sort",
              "reverse",
              "fill",
              "copyWithin"
            ])).has(methodName))
              return function(...args) {
                let result = value.apply(changeTracker.copy_, args);
                return markChanged(changeTracker), result;
              };
          }
          if (ptarget instanceof Map || ptarget instanceof Set) {
            let methodName = prop.toString();
            if ((/* @__PURE__ */ new Set([
              "set",
              "delete",
              "clear",
              "add",
              "pop",
              "push",
              "shift",
              "unshift",
              "splice",
              "sort",
              "reverse"
            ])).has(methodName))
              return function(...args) {
                let result = value.apply(changeTracker.copy_, args);
                return markChanged(changeTracker), result;
              };
            if ((/* @__PURE__ */ new Set([
              "entries",
              "keys",
              "values",
              "forEach",
              Symbol.iterator
            ])).has(methodName) || prop === Symbol.iterator)
              return function(...args) {
                let result = value.apply(changeTracker.copy_, args);
                if (methodName === "forEach") {
                  let callback = args[0];
                  if (typeof callback == "function") {
                    let wrappedCallback = function(value2, key, collection) {
                      let cbresult = callback.call(
                        this,
                        value2,
                        key,
                        collection
                      );
                      return markChanged(changeTracker), cbresult;
                    };
                    return value.apply(ptarget, [
                      wrappedCallback,
                      ...args.slice(1)
                    ]);
                  }
                }
                if (methodName === "entries" || methodName === "values" || methodName === Symbol.iterator.toString() || prop === Symbol.iterator) {
                  let originalIterator = result, valueToKeyMap = /* @__PURE__ */ new Map();
                  if (methodName === "values" && ptarget instanceof Map)
                    for (let [
                      key,
                      mapValue
                    ] of changeTracker.copy_.entries())
                      valueToKeyMap.set(mapValue, key);
                  let originalToModifiedMap = /* @__PURE__ */ new Map();
                  if (ptarget instanceof Set)
                    for (let setValue of changeTracker.copy_.values())
                      originalToModifiedMap.set(setValue, setValue);
                  return {
                    next() {
                      let nextResult = originalIterator.next();
                      if (!nextResult.done && nextResult.value && typeof nextResult.value == "object") {
                        if (methodName === "entries" && Array.isArray(nextResult.value) && nextResult.value.length === 2) {
                          if (nextResult.value[1] && typeof nextResult.value[1] == "object") {
                            let mapKey = nextResult.value[0], mapParent = {
                              tracker: changeTracker,
                              prop: mapKey,
                              updateMap: (newValue) => {
                                changeTracker.copy_ instanceof Map && changeTracker.copy_.set(mapKey, newValue);
                              }
                            }, { proxy: valueProxy } = memoizedCreateChangeProxy(
                              nextResult.value[1],
                              mapParent
                            );
                            nextResult.value[1] = valueProxy;
                          }
                        } else if ((methodName === "values" || methodName === Symbol.iterator.toString() || prop === Symbol.iterator) && typeof nextResult.value == "object" && nextResult.value !== null)
                          if (methodName === "values" && ptarget instanceof Map) {
                            let mapKey = valueToKeyMap.get(nextResult.value);
                            if (mapKey !== void 0) {
                              let mapParent = {
                                tracker: changeTracker,
                                prop: mapKey,
                                updateMap: (newValue) => {
                                  changeTracker.copy_ instanceof Map && changeTracker.copy_.set(mapKey, newValue);
                                }
                              }, { proxy: valueProxy } = memoizedCreateChangeProxy(
                                nextResult.value,
                                mapParent
                              );
                              nextResult.value = valueProxy;
                            }
                          } else if (ptarget instanceof Set) {
                            let setOriginalValue = nextResult.value, setParent = {
                              tracker: changeTracker,
                              prop: setOriginalValue,
                              // Use the original value as the prop
                              updateSet: (newValue) => {
                                changeTracker.copy_ instanceof Set && (changeTracker.copy_.delete(setOriginalValue), changeTracker.copy_.add(newValue), originalToModifiedMap.set(
                                  setOriginalValue,
                                  newValue
                                ));
                              }
                            }, { proxy: valueProxy } = memoizedCreateChangeProxy(
                              nextResult.value,
                              setParent
                            );
                            nextResult.value = valueProxy;
                          } else {
                            let tempKey = Symbol("iterator-value"), { proxy: valueProxy } = memoizedCreateChangeProxy(nextResult.value, {
                              tracker: changeTracker,
                              prop: tempKey
                            });
                            nextResult.value = valueProxy;
                          }
                      }
                      return nextResult;
                    },
                    [Symbol.iterator]() {
                      return this;
                    }
                  };
                }
                return result;
              };
          }
          return value.bind(ptarget);
        }
        if (value && typeof value == "object" && !(value instanceof Date) && !(value instanceof RegExp) && !isTemporal(value)) {
          let nestedParent = {
            tracker: changeTracker,
            prop: String(prop)
          }, { proxy: nestedProxy } = memoizedCreateChangeProxy(
            originalValue,
            nestedParent
          );
          return proxyCache.set(value, nestedProxy), nestedProxy;
        }
        return value;
      },
      set(_sobj, prop, value) {
        let currentValue = changeTracker.copy_[prop];
        if (debugLog(
          `set called for property ${String(prop)}, current:`,
          currentValue,
          "new:",
          value
        ), deepEquals(currentValue, value))
          debugLog("Value unchanged, not tracking");
        else {
          let originalValue = changeTracker.originalObject[prop], isRevertToOriginal = deepEquals(value, originalValue);
          if (debugLog(
            "value:",
            value,
            "original:",
            originalValue,
            "isRevertToOriginal:",
            isRevertToOriginal
          ), isRevertToOriginal) {
            debugLog(`Reverting property ${String(prop)} to original value`), delete changeTracker.assigned_[prop.toString()], debugLog(`Updating copy with original value for ${String(prop)}`), changeTracker.copy_[prop] = deepClone(originalValue), debugLog("Checking if all properties reverted");
            let allReverted = checkIfReverted(changeTracker);
            debugLog("All reverted:", allReverted), allReverted ? (debugLog("All properties reverted, clearing tracking"), changeTracker.modified = !1, changeTracker.assigned_ = {}, parent && (debugLog("Updating parent for property:", parent.prop), checkParentStatus(parent.tracker, parent.prop))) : (debugLog("Some properties still changed, keeping modified flag"), changeTracker.modified = !0);
          } else
            debugLog(`Setting new value for property ${String(prop)}`), changeTracker.copy_[prop] = value, changeTracker.assigned_[prop.toString()] = !0, debugLog("Marking object and ancestors as modified", changeTracker), markChanged(changeTracker);
        }
        return !0;
      },
      defineProperty(_ptarget, prop, descriptor) {
        return "value" in descriptor && (changeTracker.copy_[prop] = deepClone(descriptor.value), changeTracker.assigned_[prop.toString()] = !0, markChanged(changeTracker)), !0;
      },
      deleteProperty(dobj, prop) {
        debugLog("deleteProperty", dobj, prop);
        let stringProp = typeof prop == "symbol" ? prop.toString() : prop;
        if (stringProp in dobj) {
          let hadPropertyInOriginal = stringProp in changeTracker.originalObject;
          delete changeTracker.copy_[prop], hadPropertyInOriginal ? (changeTracker.assigned_[stringProp] = !1, changeTracker.copy_[stringProp] = void 0, markChanged(changeTracker)) : (delete changeTracker.copy_[stringProp], delete changeTracker.assigned_[stringProp], Object.keys(changeTracker.assigned_).length === 0 && Object.getOwnPropertySymbols(changeTracker.assigned_).length === 0 ? changeTracker.modified = !1 : changeTracker.modified = !0);
        }
        return !0;
      }
    });
    return proxyCache.set(obj, proxy2), proxy2;
  }
  return {
    proxy: createObjectProxy(target),
    getChanges: () => {
      if (debugLog("getChanges called, modified:", changeTracker.modified), debugLog(changeTracker), !changeTracker.modified)
        return debugLog("Object not modified, returning empty object"), {};
      if (typeof changeTracker.copy_ != "object" || Array.isArray(changeTracker.copy_) || Object.keys(changeTracker.assigned_).length === 0)
        return changeTracker.copy_;
      let result = {};
      for (let key in changeTracker.copy_)
        changeTracker.assigned_[key] === !0 && key in changeTracker.copy_ && (result[key] = changeTracker.copy_[key]);
      return debugLog("Returning copy:", result), result;
    }
  };
}
function createArrayChangeProxy(targets) {
  let proxiesWithChanges = targets.map((target) => createChangeProxy(target));
  return {
    proxies: proxiesWithChanges.map((p) => p.proxy),
    getChanges: () => proxiesWithChanges.map((p) => p.getChanges())
  };
}
function withChangeTracking(target, callback) {
  let { proxy, getChanges } = createChangeProxy(target);
  return callback(proxy), getChanges();
}
function withArrayChangeTracking(targets, callback) {
  let { proxies, getChanges } = createArrayChangeProxy(targets);
  return callback(proxies), getChanges();
}

// packages/db/dist/esm/deferred.js
function createDeferred() {
  let resolve, reject, isPending = !0;
  return {
    promise: new Promise((res, rej) => {
      resolve = (value) => {
        isPending = !1, res(value);
      }, reject = (reason) => {
        isPending = !1, rej(reason);
      };
    }),
    resolve,
    reject,
    isPending: () => isPending
  };
}

// packages/db/dist/esm/scheduler.js
var Scheduler = class {
  constructor() {
    this.contexts = /* @__PURE__ */ new Map(), this.clearListeners = /* @__PURE__ */ new Set();
  }
  /**
   * Get or create the state bucket for a context.
   */
  getOrCreateContext(contextId) {
    let context = this.contexts.get(contextId);
    return context || (context = {
      queue: [],
      jobs: /* @__PURE__ */ new Map(),
      dependencies: /* @__PURE__ */ new Map(),
      completed: /* @__PURE__ */ new Set()
    }, this.contexts.set(contextId, context)), context;
  }
  /**
   * Schedule work. Without a context id, executes immediately.
   * Otherwise queues the job to be flushed once dependencies are satisfied.
   * Scheduling the same jobId again replaces the previous run function.
   */
  schedule({ contextId, jobId, dependencies, run }) {
    if (typeof contextId > "u") {
      run();
      return;
    }
    let context = this.getOrCreateContext(contextId);
    if (context.jobs.has(jobId) || context.queue.push(jobId), context.jobs.set(jobId, run), dependencies) {
      let depSet = new Set(dependencies);
      depSet.delete(jobId), context.dependencies.set(jobId, depSet);
    } else context.dependencies.has(jobId) || context.dependencies.set(jobId, /* @__PURE__ */ new Set());
    context.completed.delete(jobId);
  }
  /**
   * Flush all queued work for a context. Jobs with unmet dependencies are retried.
   * Throws if a pass completes without running any job (dependency cycle).
   */
  flush(contextId) {
    let context = this.contexts.get(contextId);
    if (!context) return;
    let { queue, jobs, dependencies, completed } = context;
    for (; queue.length > 0; ) {
      let ranThisPass = !1, jobsThisPass = queue.length;
      for (let i = 0; i < jobsThisPass; i++) {
        let jobId = queue.shift(), run = jobs.get(jobId);
        if (!run) {
          dependencies.delete(jobId), completed.delete(jobId);
          continue;
        }
        let deps = dependencies.get(jobId), ready = !deps;
        if (deps) {
          ready = !0;
          for (let dep of deps)
            if (dep !== jobId && !completed.has(dep)) {
              ready = !1;
              break;
            }
        }
        ready ? (jobs.delete(jobId), dependencies.delete(jobId), run(), completed.add(jobId), ranThisPass = !0) : queue.push(jobId);
      }
      if (!ranThisPass)
        throw new Error(
          `Scheduler detected unresolved dependencies for context ${String(
            contextId
          )}.`
        );
    }
    this.contexts.delete(contextId);
  }
  /**
   * Flush all contexts with pending work. Useful during tear-down.
   */
  flushAll() {
    for (let contextId of Array.from(this.contexts.keys()))
      this.flush(contextId);
  }
  /** Clear all scheduled jobs for a context. */
  clear(contextId) {
    this.contexts.delete(contextId), this.clearListeners.forEach((listener) => listener(contextId));
  }
  /** Register a listener to be notified when a context is cleared. */
  onClear(listener) {
    return this.clearListeners.add(listener), () => this.clearListeners.delete(listener);
  }
  /** Check if a context has pending jobs. */
  hasPendingJobs(contextId) {
    let context = this.contexts.get(contextId);
    return !!context && context.jobs.size > 0;
  }
  /** Remove a single job from a context and clean up its dependencies. */
  clearJob(contextId, jobId) {
    let context = this.contexts.get(contextId);
    context && (context.jobs.delete(jobId), context.dependencies.delete(jobId), context.completed.delete(jobId), context.queue = context.queue.filter((id) => id !== jobId), context.jobs.size === 0 && this.contexts.delete(contextId));
  }
}, transactionScopedScheduler = new Scheduler();

// packages/db/dist/esm/transactions.js
var transactions = [], transactionStack = [], sequenceNumber = 0;
function mergePendingMutations(existing, incoming) {
  switch (`${existing.type}-${incoming.type}`) {
    case "insert-update":
      return {
        ...existing,
        type: "insert",
        original: {},
        modified: incoming.modified,
        changes: { ...existing.changes, ...incoming.changes },
        // Keep existing keys (key changes not allowed in updates)
        key: existing.key,
        globalKey: existing.globalKey,
        // Merge metadata (last-write-wins)
        metadata: incoming.metadata ?? existing.metadata,
        syncMetadata: { ...existing.syncMetadata, ...incoming.syncMetadata },
        // Update tracking info
        mutationId: incoming.mutationId,
        updatedAt: incoming.updatedAt
      };
    case "insert-delete":
      return null;
    case "update-delete":
      return incoming;
    case "update-update":
      return {
        ...incoming,
        // Keep original from first update
        original: existing.original,
        // Union the changes from both updates
        changes: { ...existing.changes, ...incoming.changes },
        // Merge metadata
        metadata: incoming.metadata ?? existing.metadata,
        syncMetadata: { ...existing.syncMetadata, ...incoming.syncMetadata }
      };
    case "delete-delete":
    case "insert-insert":
      return incoming;
    default: {
      let _exhaustive = `${existing.type}-${incoming.type}`;
      throw new Error(`Unhandled mutation combination: ${_exhaustive}`);
    }
  }
}
function createTransaction(config) {
  let newTransaction = new Transaction(config);
  return transactions.push(newTransaction), newTransaction;
}
function getActiveTransaction() {
  if (transactionStack.length > 0)
    return transactionStack.slice(-1)[0];
}
function registerTransaction(tx) {
  transactionScopedScheduler.clear(tx.id), transactionStack.push(tx);
}
function unregisterTransaction(tx) {
  try {
    transactionScopedScheduler.flush(tx.id);
  } finally {
    transactionStack = transactionStack.filter((t) => t.id !== tx.id);
  }
}
function removeFromPendingList(tx) {
  let index = transactions.findIndex((t) => t.id === tx.id);
  index !== -1 && transactions.splice(index, 1);
}
var Transaction = class {
  constructor(config) {
    if (typeof config.mutationFn > "u")
      throw new MissingMutationFunctionError();
    this.id = config.id ?? crypto.randomUUID(), this.mutationFn = config.mutationFn, this.state = "pending", this.mutations = [], this.isPersisted = createDeferred(), this.autoCommit = config.autoCommit ?? !0, this.createdAt = /* @__PURE__ */ new Date(), this.sequenceNumber = sequenceNumber++, this.metadata = config.metadata ?? {};
  }
  setState(newState) {
    this.state = newState, (newState === "completed" || newState === "failed") && removeFromPendingList(this);
  }
  /**
   * Execute collection operations within this transaction
   * @param callback - Function containing collection operations to group together
   * @returns This transaction for chaining
   * @example
   * // Group multiple operations
   * const tx = createTransaction({ mutationFn: async () => {
   *   // Send to API
   * }})
   *
   * tx.mutate(() => {
   *   collection.insert({ id: "1", text: "Buy milk" })
   *   collection.update("2", draft => { draft.completed = true })
   *   collection.delete("3")
   * })
   *
   * await tx.isPersisted.promise
   *
   * @example
   * // Handle mutate errors
   * try {
   *   tx.mutate(() => {
   *     collection.insert({ id: "invalid" }) // This might throw
   *   })
   * } catch (error) {
   *   console.log('Mutation failed:', error)
   * }
   *
   * @example
   * // Manual commit control
   * const tx = createTransaction({ autoCommit: false, mutationFn: async () => {} })
   *
   * tx.mutate(() => {
   *   collection.insert({ id: "1", text: "Item" })
   * })
   *
   * // Commit later when ready
   * await tx.commit()
   */
  mutate(callback) {
    if (this.state !== "pending")
      throw new TransactionNotPendingMutateError();
    registerTransaction(this);
    try {
      callback();
    } finally {
      unregisterTransaction(this);
    }
    return this.autoCommit && this.commit().catch(() => {
    }), this;
  }
  /**
   * Apply new mutations to this transaction, intelligently merging with existing mutations
   *
   * When mutations operate on the same item (same globalKey), they are merged according to
   * the following rules:
   *
   * - **insert + update** → insert (merge changes, keep empty original)
   * - **insert + delete** → removed (mutations cancel each other out)
   * - **update + delete** → delete (delete dominates)
   * - **update + update** → update (union changes, keep first original)
   * - **same type** → replace with latest
   *
   * This merging reduces over-the-wire churn and keeps the optimistic local view
   * aligned with user intent.
   *
   * @param mutations - Array of new mutations to apply
   */
  applyMutations(mutations) {
    for (let newMutation of mutations) {
      let existingIndex = this.mutations.findIndex(
        (m) => m.globalKey === newMutation.globalKey
      );
      if (existingIndex >= 0) {
        let existingMutation = this.mutations[existingIndex], mergeResult = mergePendingMutations(existingMutation, newMutation);
        mergeResult === null ? this.mutations.splice(existingIndex, 1) : this.mutations[existingIndex] = mergeResult;
      } else
        this.mutations.push(newMutation);
    }
  }
  /**
   * Rollback the transaction and any conflicting transactions
   * @param config - Configuration for rollback behavior
   * @returns This transaction for chaining
   * @example
   * // Manual rollback
   * const tx = createTransaction({ mutationFn: async () => {
   *   // Send to API
   * }})
   *
   * tx.mutate(() => {
   *   collection.insert({ id: "1", text: "Buy milk" })
   * })
   *
   * // Rollback if needed
   * if (shouldCancel) {
   *   tx.rollback()
   * }
   *
   * @example
   * // Handle rollback cascade (automatic)
   * const tx1 = createTransaction({ mutationFn: async () => {} })
   * const tx2 = createTransaction({ mutationFn: async () => {} })
   *
   * tx1.mutate(() => collection.update("1", draft => { draft.value = "A" }))
   * tx2.mutate(() => collection.update("1", draft => { draft.value = "B" })) // Same item
   *
   * tx1.rollback() // This will also rollback tx2 due to conflict
   *
   * @example
   * // Handle rollback in error scenarios
   * try {
   *   await tx.isPersisted.promise
   * } catch (error) {
   *   console.log('Transaction was rolled back:', error)
   *   // Transaction automatically rolled back on mutation function failure
   * }
   */
  rollback(config) {
    let isSecondaryRollback = config?.isSecondaryRollback ?? !1;
    if (this.state === "completed")
      throw new TransactionAlreadyCompletedRollbackError();
    if (this.setState("failed"), !isSecondaryRollback) {
      let mutationIds = /* @__PURE__ */ new Set();
      this.mutations.forEach((m) => mutationIds.add(m.globalKey));
      for (let t of transactions)
        t.state === "pending" && t.mutations.some((m) => mutationIds.has(m.globalKey)) && t.rollback({ isSecondaryRollback: !0 });
    }
    return this.isPersisted.reject(this.error?.error), this.touchCollection(), this;
  }
  // Tell collection that something has changed with the transaction
  touchCollection() {
    let hasCalled = /* @__PURE__ */ new Set();
    for (let mutation of this.mutations)
      hasCalled.has(mutation.collection.id) || (mutation.collection._state.onTransactionStateChange(), mutation.collection._state.pendingSyncedTransactions.length > 0 && mutation.collection._state.commitPendingTransactions(), hasCalled.add(mutation.collection.id));
  }
  /**
   * Commit the transaction and execute the mutation function
   * @returns Promise that resolves to this transaction when complete
   * @example
   * // Manual commit (when autoCommit is false)
   * const tx = createTransaction({
   *   autoCommit: false,
   *   mutationFn: async ({ transaction }) => {
   *     await api.saveChanges(transaction.mutations)
   *   }
   * })
   *
   * tx.mutate(() => {
   *   collection.insert({ id: "1", text: "Buy milk" })
   * })
   *
   * await tx.commit() // Manually commit
   *
   * @example
   * // Handle commit errors
   * try {
   *   const tx = createTransaction({
   *     mutationFn: async () => { throw new Error("API failed") }
   *   })
   *
   *   tx.mutate(() => {
   *     collection.insert({ id: "1", text: "Item" })
   *   })
   *
   *   await tx.commit()
   * } catch (error) {
   *   console.log('Commit failed, transaction rolled back:', error)
   * }
   *
   * @example
   * // Check transaction state after commit
   * await tx.commit()
   * console.log(tx.state) // "completed" or "failed"
   */
  async commit() {
    if (this.state !== "pending")
      throw new TransactionNotPendingCommitError();
    if (this.setState("persisting"), this.mutations.length === 0)
      return this.setState("completed"), this.isPersisted.resolve(this), this;
    try {
      await this.mutationFn({
        transaction: this
      }), this.setState("completed"), this.touchCollection(), this.isPersisted.resolve(this);
    } catch (error) {
      let originalError = error instanceof Error ? error : new Error(String(error));
      throw this.error = {
        message: originalError.message,
        error: originalError
      }, this.rollback(), originalError;
    }
    return this;
  }
  /**
   * Compare two transactions by their createdAt time and sequence number in order
   * to sort them in the order they were created.
   * @param other - The other transaction to compare to
   * @returns -1 if this transaction was created before the other, 1 if it was created after, 0 if they were created at the same time
   */
  compareCreatedAt(other) {
    let createdAtComparison = this.createdAt.getTime() - other.createdAt.getTime();
    return createdAtComparison !== 0 ? createdAtComparison : this.sequenceNumber - other.sequenceNumber;
  }
};

// packages/db/dist/esm/collection/mutations.js
var CollectionMutationsManager = class {
  constructor(config, id) {
    this.insert = (data, config2) => {
      this.lifecycle.validateCollectionUsable("insert");
      let state = this.state, ambientTransaction = getActiveTransaction();
      if (!ambientTransaction && !this.config.onInsert)
        throw new MissingInsertHandlerError();
      let items = Array.isArray(data) ? data : [data], mutations = [];
      if (items.forEach((item) => {
        let validatedData = this.validateData(item, "insert"), key = this.config.getKey(validatedData);
        if (this.state.has(key))
          throw new DuplicateKeyError(key);
        let globalKey = this.generateGlobalKey(key, item), mutation = {
          mutationId: crypto.randomUUID(),
          original: {},
          modified: validatedData,
          // Pick the values from validatedData based on what's passed in - this is for cases
          // where a schema has default values. The validated data has the extra default
          // values but for changes, we just want to show the data that was actually passed in.
          changes: Object.fromEntries(
            Object.keys(item).map((k) => [
              k,
              validatedData[k]
            ])
          ),
          globalKey,
          key,
          metadata: config2?.metadata,
          syncMetadata: this.config.sync.getSyncMetadata?.() || {},
          optimistic: config2?.optimistic ?? !0,
          type: "insert",
          createdAt: /* @__PURE__ */ new Date(),
          updatedAt: /* @__PURE__ */ new Date(),
          collection: this.collection
        };
        mutations.push(mutation);
      }), ambientTransaction)
        return ambientTransaction.applyMutations(mutations), state.transactions.set(ambientTransaction.id, ambientTransaction), state.scheduleTransactionCleanup(ambientTransaction), state.recomputeOptimisticState(!0), ambientTransaction;
      {
        let directOpTransaction = createTransaction({
          mutationFn: async (params) => await this.config.onInsert({
            transaction: params.transaction,
            collection: this.collection
          })
        });
        return directOpTransaction.applyMutations(mutations), directOpTransaction.commit().catch(() => {
        }), state.transactions.set(directOpTransaction.id, directOpTransaction), state.scheduleTransactionCleanup(directOpTransaction), state.recomputeOptimisticState(!0), directOpTransaction;
      }
    }, this.delete = (keys, config2) => {
      let state = this.state;
      this.lifecycle.validateCollectionUsable("delete");
      let ambientTransaction = getActiveTransaction();
      if (!ambientTransaction && !this.config.onDelete)
        throw new MissingDeleteHandlerError();
      if (Array.isArray(keys) && keys.length === 0)
        throw new NoKeysPassedToDeleteError();
      let keysArray = Array.isArray(keys) ? keys : [keys], mutations = [];
      for (let key of keysArray) {
        if (!this.state.has(key))
          throw new DeleteKeyNotFoundError(key);
        let globalKey = this.generateGlobalKey(key, this.state.get(key)), mutation = {
          mutationId: crypto.randomUUID(),
          original: this.state.get(key),
          modified: this.state.get(key),
          changes: this.state.get(key),
          globalKey,
          key,
          metadata: config2?.metadata,
          syncMetadata: state.syncedMetadata.get(key) || {},
          optimistic: config2?.optimistic ?? !0,
          type: "delete",
          createdAt: /* @__PURE__ */ new Date(),
          updatedAt: /* @__PURE__ */ new Date(),
          collection: this.collection
        };
        mutations.push(mutation);
      }
      if (ambientTransaction)
        return ambientTransaction.applyMutations(mutations), state.transactions.set(ambientTransaction.id, ambientTransaction), state.scheduleTransactionCleanup(ambientTransaction), state.recomputeOptimisticState(!0), ambientTransaction;
      let directOpTransaction = createTransaction({
        autoCommit: !0,
        mutationFn: async (params) => this.config.onDelete({
          transaction: params.transaction,
          collection: this.collection
        })
      });
      return directOpTransaction.applyMutations(mutations), directOpTransaction.commit().catch(() => {
      }), state.transactions.set(directOpTransaction.id, directOpTransaction), state.scheduleTransactionCleanup(directOpTransaction), state.recomputeOptimisticState(!0), directOpTransaction;
    }, this.id = id, this.config = config;
  }
  setDeps(deps) {
    this.lifecycle = deps.lifecycle, this.state = deps.state, this.collection = deps.collection;
  }
  ensureStandardSchema(schema) {
    if (schema && "~standard" in schema)
      return schema;
    throw new InvalidSchemaError();
  }
  validateData(data, type, key) {
    if (!this.config.schema) return data;
    let standardSchema = this.ensureStandardSchema(this.config.schema);
    if (type === "update" && key) {
      let existingData = this.state.get(key);
      if (existingData && data && typeof data == "object" && typeof existingData == "object") {
        let mergedData = Object.assign({}, existingData, data), result2 = standardSchema["~standard"].validate(mergedData);
        if (result2 instanceof Promise)
          throw new SchemaMustBeSynchronousError();
        if ("issues" in result2 && result2.issues) {
          let typedIssues = result2.issues.map((issue) => ({
            message: issue.message,
            path: issue.path?.map((p) => String(p))
          }));
          throw new SchemaValidationError(type, typedIssues);
        }
        let validatedMergedData = result2.value, modifiedKeys = Object.keys(data);
        return Object.fromEntries(
          modifiedKeys.map((k) => [k, validatedMergedData[k]])
        );
      }
    }
    let result = standardSchema["~standard"].validate(data);
    if (result instanceof Promise)
      throw new SchemaMustBeSynchronousError();
    if ("issues" in result && result.issues) {
      let typedIssues = result.issues.map((issue) => ({
        message: issue.message,
        path: issue.path?.map((p) => String(p))
      }));
      throw new SchemaValidationError(type, typedIssues);
    }
    return result.value;
  }
  generateGlobalKey(key, item) {
    if (typeof key > "u")
      throw new UndefinedKeyError(item);
    return `KEY::${this.id}/${key}`;
  }
  /**
   * Updates one or more items in the collection using a callback function
   */
  update(keys, configOrCallback, maybeCallback) {
    if (typeof keys > "u")
      throw new MissingUpdateArgumentError();
    let state = this.state;
    this.lifecycle.validateCollectionUsable("update");
    let ambientTransaction = getActiveTransaction();
    if (!ambientTransaction && !this.config.onUpdate)
      throw new MissingUpdateHandlerError();
    let isArray = Array.isArray(keys), keysArray = isArray ? keys : [keys];
    if (isArray && keysArray.length === 0)
      throw new NoKeysPassedToUpdateError();
    let callback = typeof configOrCallback == "function" ? configOrCallback : maybeCallback, config = typeof configOrCallback == "function" ? {} : configOrCallback, currentObjects = keysArray.map((key) => {
      let item = this.state.get(key);
      if (!item)
        throw new UpdateKeyNotFoundError(key);
      return item;
    }), changesArray;
    isArray ? changesArray = withArrayChangeTracking(
      currentObjects,
      callback
    ) : changesArray = [withChangeTracking(
      currentObjects[0],
      callback
    )];
    let mutations = keysArray.map((key, index) => {
      let itemChanges = changesArray[index];
      if (!itemChanges || Object.keys(itemChanges).length === 0)
        return null;
      let originalItem = currentObjects[index], validatedUpdatePayload = this.validateData(
        itemChanges,
        "update",
        key
      ), modifiedItem = Object.assign(
        {},
        originalItem,
        validatedUpdatePayload
      ), originalItemId = this.config.getKey(originalItem), modifiedItemId = this.config.getKey(modifiedItem);
      if (originalItemId !== modifiedItemId)
        throw new KeyUpdateNotAllowedError(originalItemId, modifiedItemId);
      let globalKey = this.generateGlobalKey(modifiedItemId, modifiedItem);
      return {
        mutationId: crypto.randomUUID(),
        original: originalItem,
        modified: modifiedItem,
        // Pick the values from modifiedItem based on what's passed in - this is for cases
        // where a schema has default values or transforms. The modified data has the extra
        // default or transformed values but for changes, we just want to show the data that
        // was actually passed in.
        changes: Object.fromEntries(
          Object.keys(itemChanges).map((k) => [
            k,
            modifiedItem[k]
          ])
        ),
        globalKey,
        key,
        metadata: config.metadata,
        syncMetadata: state.syncedMetadata.get(key) || {},
        optimistic: config.optimistic ?? !0,
        type: "update",
        createdAt: /* @__PURE__ */ new Date(),
        updatedAt: /* @__PURE__ */ new Date(),
        collection: this.collection
      };
    }).filter(Boolean);
    if (mutations.length === 0) {
      let emptyTransaction = createTransaction({
        mutationFn: async () => {
        }
      });
      return emptyTransaction.commit().catch(() => {
      }), state.scheduleTransactionCleanup(emptyTransaction), emptyTransaction;
    }
    if (ambientTransaction)
      return ambientTransaction.applyMutations(mutations), state.transactions.set(ambientTransaction.id, ambientTransaction), state.scheduleTransactionCleanup(ambientTransaction), state.recomputeOptimisticState(!0), ambientTransaction;
    let directOpTransaction = createTransaction({
      mutationFn: async (params) => this.config.onUpdate({
        transaction: params.transaction,
        collection: this.collection
      })
    });
    return directOpTransaction.applyMutations(mutations), directOpTransaction.commit().catch(() => {
    }), state.transactions.set(directOpTransaction.id, directOpTransaction), state.scheduleTransactionCleanup(directOpTransaction), state.recomputeOptimisticState(!0), directOpTransaction;
  }
};

// packages/db/dist/esm/collection/events.js
var CollectionEventsManager = class extends EventEmitter {
  constructor() {
    super();
  }
  setDeps(deps) {
    this.collection = deps.collection;
  }
  /**
   * Emit an event to all listeners
   * Public API for emitting collection events
   */
  emit(event, eventPayload) {
    this.emitInner(event, eventPayload);
  }
  emitStatusChange(status, previousStatus) {
    this.emit("status:change", {
      type: "status:change",
      collection: this.collection,
      previousStatus,
      status
    });
    let eventKey = `status:${status}`;
    this.emit(eventKey, {
      type: eventKey,
      collection: this.collection,
      previousStatus,
      status
    });
  }
  emitSubscribersChange(subscriberCount, previousSubscriberCount) {
    this.emit("subscribers:change", {
      type: "subscribers:change",
      collection: this.collection,
      previousSubscriberCount,
      subscriberCount
    });
  }
  cleanup() {
    this.clearListeners();
  }
};

// packages/db/dist/esm/collection/index.js
function createCollection(options) {
  let collection = new CollectionImpl(
    options
  );
  return options.utils ? collection.utils = { ...options.utils } : collection.utils = {}, collection;
}
var CollectionImpl = class {
  /**
   * Creates a new Collection instance
   *
   * @param config - Configuration object for the collection
   * @throws Error if sync config is missing
   */
  constructor(config) {
    if (this.utils = {}, this.insert = (data, config2) => this._mutations.insert(data, config2), this.delete = (keys, config2) => this._mutations.delete(keys, config2), !config)
      throw new CollectionRequiresConfigError();
    if (!config.sync)
      throw new CollectionRequiresSyncConfigError();
    config.id ? this.id = config.id : this.id = crypto.randomUUID(), this.config = {
      ...config,
      autoIndex: config.autoIndex ?? "eager"
    }, this._changes = new CollectionChangesManager(), this._events = new CollectionEventsManager(), this._indexes = new CollectionIndexesManager(), this._lifecycle = new CollectionLifecycleManager(config, this.id), this._mutations = new CollectionMutationsManager(config, this.id), this._state = new CollectionStateManager(config), this._sync = new CollectionSyncManager(config, this.id), this._changes.setDeps({
      collection: this,
      // Required for passing to CollectionSubscription
      lifecycle: this._lifecycle,
      sync: this._sync,
      events: this._events
    }), this._events.setDeps({
      collection: this
      // Required for adding to emitted events
    }), this._indexes.setDeps({
      state: this._state,
      lifecycle: this._lifecycle
    }), this._lifecycle.setDeps({
      changes: this._changes,
      events: this._events,
      indexes: this._indexes,
      state: this._state,
      sync: this._sync
    }), this._mutations.setDeps({
      collection: this,
      // Required for passing to config.onInsert/onUpdate/onDelete and annotating mutations
      lifecycle: this._lifecycle,
      state: this._state
    }), this._state.setDeps({
      collection: this,
      // Required for filtering events to only include this collection
      lifecycle: this._lifecycle,
      changes: this._changes,
      indexes: this._indexes
    }), this._sync.setDeps({
      collection: this,
      // Required for passing to config.sync callback
      state: this._state,
      lifecycle: this._lifecycle,
      events: this._events
    }), config.startSync === !0 && this._sync.startSync();
  }
  /**
   * Gets the current status of the collection
   */
  get status() {
    return this._lifecycle.status;
  }
  /**
   * Get the number of subscribers to the collection
   */
  get subscriberCount() {
    return this._changes.activeSubscribersCount;
  }
  /**
   * Register a callback to be executed when the collection first becomes ready
   * Useful for preloading collections
   * @param callback Function to call when the collection first becomes ready
   * @example
   * collection.onFirstReady(() => {
   *   console.log('Collection is ready for the first time')
   *   // Safe to access collection.state now
   * })
   */
  onFirstReady(callback) {
    return this._lifecycle.onFirstReady(callback);
  }
  /**
   * Check if the collection is ready for use
   * Returns true if the collection has been marked as ready by its sync implementation
   * @returns true if the collection is ready, false otherwise
   * @example
   * if (collection.isReady()) {
   *   console.log('Collection is ready, data is available')
   *   // Safe to access collection.state
   * } else {
   *   console.log('Collection is still loading')
   * }
   */
  isReady() {
    return this._lifecycle.status === "ready";
  }
  /**
   * Check if the collection is currently loading more data
   * @returns true if the collection has pending load more operations, false otherwise
   */
  get isLoadingSubset() {
    return this._sync.isLoadingSubset;
  }
  /**
   * Start sync immediately - internal method for compiled queries
   * This bypasses lazy loading for special cases like live query results
   */
  startSyncImmediate() {
    this._sync.startSync();
  }
  /**
   * Preload the collection data by starting sync if not already started
   * Multiple concurrent calls will share the same promise
   */
  preload() {
    return this._sync.preload();
  }
  /**
   * Get the current value for a key (virtual derived state)
   */
  get(key) {
    return this._state.get(key);
  }
  /**
   * Check if a key exists in the collection (virtual derived state)
   */
  has(key) {
    return this._state.has(key);
  }
  /**
   * Get the current size of the collection (cached)
   */
  get size() {
    return this._state.size;
  }
  /**
   * Get all keys (virtual derived state)
   */
  *keys() {
    yield* this._state.keys();
  }
  /**
   * Get all values (virtual derived state)
   */
  *values() {
    yield* this._state.values();
  }
  /**
   * Get all entries (virtual derived state)
   */
  *entries() {
    yield* this._state.entries();
  }
  /**
   * Get all entries (virtual derived state)
   */
  *[Symbol.iterator]() {
    yield* this._state[Symbol.iterator]();
  }
  /**
   * Execute a callback for each entry in the collection
   */
  forEach(callbackfn) {
    return this._state.forEach(callbackfn);
  }
  /**
   * Create a new array with the results of calling a function for each entry in the collection
   */
  map(callbackfn) {
    return this._state.map(callbackfn);
  }
  getKeyFromItem(item) {
    return this.config.getKey(item);
  }
  /**
   * Creates an index on a collection for faster queries.
   * Indexes significantly improve query performance by allowing constant time lookups
   * and logarithmic time range queries instead of full scans.
   *
   * @template TResolver - The type of the index resolver (constructor or async loader)
   * @param indexCallback - Function that extracts the indexed value from each item
   * @param config - Configuration including index type and type-specific options
   * @returns An index proxy that provides access to the index when ready
   *
   * @example
   * // Create a default B+ tree index
   * const ageIndex = collection.createIndex((row) => row.age)
   *
   * // Create a ordered index with custom options
   * const ageIndex = collection.createIndex((row) => row.age, {
   *   indexType: BTreeIndex,
   *   options: {
   *     compareFn: customComparator,
   *     compareOptions: { direction: 'asc', nulls: 'first', stringSort: 'lexical' }
   *   },
   *   name: 'age_btree'
   * })
   *
   * // Create an async-loaded index
   * const textIndex = collection.createIndex((row) => row.content, {
   *   indexType: async () => {
   *     const { FullTextIndex } = await import('./indexes/fulltext.js')
   *     return FullTextIndex
   *   },
   *   options: { language: 'en' }
   * })
   */
  createIndex(indexCallback, config = {}) {
    return this._indexes.createIndex(indexCallback, config);
  }
  /**
   * Get resolved indexes for query optimization
   */
  get indexes() {
    return this._indexes.indexes;
  }
  /**
   * Validates the data against the schema
   */
  validateData(data, type, key) {
    return this._mutations.validateData(data, type, key);
  }
  update(keys, configOrCallback, maybeCallback) {
    return this._mutations.update(keys, configOrCallback, maybeCallback);
  }
  /**
   * Gets the current state of the collection as a Map
   * @returns Map containing all items in the collection, with keys as identifiers
   * @example
   * const itemsMap = collection.state
   * console.log(`Collection has ${itemsMap.size} items`)
   *
   * for (const [key, item] of itemsMap) {
   *   console.log(`${key}: ${item.title}`)
   * }
   *
   * // Check if specific item exists
   * if (itemsMap.has("todo-1")) {
   *   console.log("Todo 1 exists:", itemsMap.get("todo-1"))
   * }
   */
  get state() {
    let result = /* @__PURE__ */ new Map();
    for (let [key, value] of this.entries())
      result.set(key, value);
    return result;
  }
  /**
   * Gets the current state of the collection as a Map, but only resolves when data is available
   * Waits for the first sync commit to complete before resolving
   *
   * @returns Promise that resolves to a Map containing all items in the collection
   */
  stateWhenReady() {
    return this.size > 0 || this.isReady() ? Promise.resolve(this.state) : this.preload().then(() => this.state);
  }
  /**
   * Gets the current state of the collection as an Array
   *
   * @returns An Array containing all items in the collection
   */
  get toArray() {
    return Array.from(this.values());
  }
  /**
   * Gets the current state of the collection as an Array, but only resolves when data is available
   * Waits for the first sync commit to complete before resolving
   *
   * @returns Promise that resolves to an Array containing all items in the collection
   */
  toArrayWhenReady() {
    return this.size > 0 || this.isReady() ? Promise.resolve(this.toArray) : this.preload().then(() => this.toArray);
  }
  /**
   * Returns the current state of the collection as an array of changes
   * @param options - Options including optional where filter
   * @returns An array of changes
   * @example
   * // Get all items as changes
   * const allChanges = collection.currentStateAsChanges()
   *
   * // Get only items matching a condition
   * const activeChanges = collection.currentStateAsChanges({
   *   where: (row) => row.status === 'active'
   * })
   *
   * // Get only items using a pre-compiled expression
   * const activeChanges = collection.currentStateAsChanges({
   *   whereExpression: eq(row.status, 'active')
   * })
   */
  currentStateAsChanges(options = {}) {
    return currentStateAsChanges(this, options);
  }
  /**
   * Subscribe to changes in the collection
   * @param callback - Function called when items change
   * @param options - Subscription options including includeInitialState and where filter
   * @returns Unsubscribe function - Call this to stop listening for changes
   * @example
   * // Basic subscription
   * const subscription = collection.subscribeChanges((changes) => {
   *   changes.forEach(change => {
   *     console.log(`${change.type}: ${change.key}`, change.value)
   *   })
   * })
   *
   * // Later: subscription.unsubscribe()
   *
   * @example
   * // Include current state immediately
   * const subscription = collection.subscribeChanges((changes) => {
   *   updateUI(changes)
   * }, { includeInitialState: true })
   *
   * @example
   * // Subscribe only to changes matching a condition
   * const subscription = collection.subscribeChanges((changes) => {
   *   updateUI(changes)
   * }, {
   *   includeInitialState: true,
   *   where: (row) => row.status === 'active'
   * })
   *
   * @example
   * // Subscribe using a pre-compiled expression
   * const subscription = collection.subscribeChanges((changes) => {
   *   updateUI(changes)
   * }, {
   *   includeInitialState: true,
   *   whereExpression: eq(row.status, 'active')
   * })
   */
  subscribeChanges(callback, options = {}) {
    return this._changes.subscribeChanges(callback, options);
  }
  /**
   * Subscribe to a collection event
   */
  on(event, callback) {
    return this._events.on(event, callback);
  }
  /**
   * Subscribe to a collection event once
   */
  once(event, callback) {
    return this._events.once(event, callback);
  }
  /**
   * Unsubscribe from a collection event
   */
  off(event, callback) {
    this._events.off(event, callback);
  }
  /**
   * Wait for a collection event
   */
  waitFor(event, timeout) {
    return this._events.waitFor(event, timeout);
  }
  /**
   * Clean up the collection by stopping sync and clearing data
   * This can be called manually or automatically by garbage collection
   */
  async cleanup() {
    return this._lifecycle.cleanup(), Promise.resolve();
  }
};

// packages/db/dist/esm/local-storage.js
function validateJsonSerializable(value, operation) {
  try {
    JSON.stringify(value);
  } catch (error) {
    throw new SerializationError(
      operation,
      error instanceof Error ? error.message : String(error)
    );
  }
}
function generateUuid() {
  return crypto.randomUUID();
}
function createInMemoryStorage() {
  let storage = /* @__PURE__ */ new Map();
  return {
    getItem(key) {
      return storage.get(key) ?? null;
    },
    setItem(key, value) {
      storage.set(key, value);
    },
    removeItem(key) {
      storage.delete(key);
    }
  };
}
function createNoOpStorageEventApi() {
  return {
    addEventListener: () => {
    },
    removeEventListener: () => {
    }
  };
}
function localStorageCollectionOptions(config) {
  if (!config.storageKey)
    throw new StorageKeyRequiredError();
  let storage = config.storage || (typeof window < "u" ? window.localStorage : null) || createInMemoryStorage(), storageEventApi = config.storageEventApi || (typeof window < "u" ? window : null) || createNoOpStorageEventApi(), lastKnownData = /* @__PURE__ */ new Map(), sync = createLocalStorageSync(
    config.storageKey,
    storage,
    storageEventApi,
    config.getKey,
    lastKnownData
  ), triggerLocalSync = () => {
    sync.manualTrigger && sync.manualTrigger();
  }, saveToStorage = (dataMap) => {
    try {
      let objectData = {};
      dataMap.forEach((storedItem, key) => {
        objectData[String(key)] = storedItem;
      });
      let serialized = JSON.stringify(objectData);
      storage.setItem(config.storageKey, serialized);
    } catch (error) {
      throw console.error(
        `[LocalStorageCollection] Error saving data to storage key "${config.storageKey}":`,
        error
      ), error;
    }
  }, clearStorage = () => {
    storage.removeItem(config.storageKey);
  }, getStorageSize = () => {
    let data = storage.getItem(config.storageKey);
    return data ? new Blob([data]).size : 0;
  }, wrappedOnInsert = async (params) => {
    params.transaction.mutations.forEach((mutation) => {
      validateJsonSerializable(mutation.modified, "insert");
    });
    let handlerResult = {};
    config.onInsert && (handlerResult = await config.onInsert(params) ?? {});
    let currentData = loadFromStorage(config.storageKey, storage);
    return params.transaction.mutations.forEach((mutation) => {
      let key = config.getKey(mutation.modified), storedItem = {
        versionKey: generateUuid(),
        data: mutation.modified
      };
      currentData.set(key, storedItem);
    }), saveToStorage(currentData), triggerLocalSync(), handlerResult;
  }, wrappedOnUpdate = async (params) => {
    params.transaction.mutations.forEach((mutation) => {
      validateJsonSerializable(mutation.modified, "update");
    });
    let handlerResult = {};
    config.onUpdate && (handlerResult = await config.onUpdate(params) ?? {});
    let currentData = loadFromStorage(config.storageKey, storage);
    return params.transaction.mutations.forEach((mutation) => {
      let key = config.getKey(mutation.modified), storedItem = {
        versionKey: generateUuid(),
        data: mutation.modified
      };
      currentData.set(key, storedItem);
    }), saveToStorage(currentData), triggerLocalSync(), handlerResult;
  }, wrappedOnDelete = async (params) => {
    let handlerResult = {};
    config.onDelete && (handlerResult = await config.onDelete(params) ?? {});
    let currentData = loadFromStorage(config.storageKey, storage);
    return params.transaction.mutations.forEach((mutation) => {
      let key = config.getKey(mutation.original);
      currentData.delete(key);
    }), saveToStorage(currentData), triggerLocalSync(), handlerResult;
  }, {
    storageKey: _storageKey,
    storage: _storage,
    storageEventApi: _storageEventApi,
    onInsert: _onInsert,
    onUpdate: _onUpdate,
    onDelete: _onDelete,
    id,
    ...restConfig
  } = config, collectionId = id ?? `local-collection:${config.storageKey}`;
  return {
    ...restConfig,
    id: collectionId,
    sync,
    onInsert: wrappedOnInsert,
    onUpdate: wrappedOnUpdate,
    onDelete: wrappedOnDelete,
    utils: {
      clearStorage,
      getStorageSize,
      acceptMutations: (transaction) => {
        let collectionMutations = transaction.mutations.filter((m) => sync.collection && m.collection === sync.collection ? !0 : m.collection.id === collectionId);
        if (collectionMutations.length === 0)
          return;
        for (let mutation of collectionMutations)
          switch (mutation.type) {
            case "insert":
            case "update":
              validateJsonSerializable(mutation.modified, mutation.type);
              break;
            case "delete":
              validateJsonSerializable(mutation.original, mutation.type);
              break;
          }
        let currentData = loadFromStorage(
          config.storageKey,
          storage
        );
        for (let mutation of collectionMutations) {
          let key = mutation.key;
          switch (mutation.type) {
            case "insert":
            case "update": {
              let storedItem = {
                versionKey: generateUuid(),
                data: mutation.modified
              };
              currentData.set(key, storedItem);
              break;
            }
            case "delete": {
              currentData.delete(key);
              break;
            }
          }
        }
        saveToStorage(currentData), sync.confirmOperationsSync(collectionMutations);
      }
    }
  };
}
function loadFromStorage(storageKey, storage) {
  try {
    let rawData = storage.getItem(storageKey);
    if (!rawData)
      return /* @__PURE__ */ new Map();
    let parsed = JSON.parse(rawData), dataMap = /* @__PURE__ */ new Map();
    if (typeof parsed == "object" && parsed !== null && !Array.isArray(parsed))
      Object.entries(parsed).forEach(([key, value]) => {
        if (value && typeof value == "object" && "versionKey" in value && "data" in value) {
          let storedItem = value;
          dataMap.set(key, storedItem);
        } else
          throw new InvalidStorageDataFormatError(storageKey, key);
      });
    else
      throw new InvalidStorageObjectFormatError(storageKey);
    return dataMap;
  } catch (error) {
    return console.warn(
      `[LocalStorageCollection] Error loading data from storage key "${storageKey}":`,
      error
    ), /* @__PURE__ */ new Map();
  }
}
function createLocalStorageSync(storageKey, storage, storageEventApi, _getKey, lastKnownData) {
  let syncParams = null, collection = null, findChanges = (oldData, newData) => {
    let changes = [];
    return oldData.forEach((oldStoredItem, key) => {
      let newStoredItem = newData.get(key);
      newStoredItem ? oldStoredItem.versionKey !== newStoredItem.versionKey && changes.push({ type: "update", key, value: newStoredItem.data }) : changes.push({ type: "delete", key, value: oldStoredItem.data });
    }), newData.forEach((newStoredItem, key) => {
      oldData.has(key) || changes.push({ type: "insert", key, value: newStoredItem.data });
    }), changes;
  }, processStorageChanges = () => {
    if (!syncParams) return;
    let { begin, write, commit } = syncParams, newData = loadFromStorage(storageKey, storage), changes = findChanges(lastKnownData, newData);
    changes.length > 0 && (begin(), changes.forEach(({ type, value }) => {
      value && (validateJsonSerializable(value, type), write({ type, value }));
    }), commit(), lastKnownData.clear(), newData.forEach((storedItem, key) => {
      lastKnownData.set(key, storedItem);
    }));
  };
  return {
    ...{
      sync: (params) => {
        let { begin, write, commit, markReady } = params;
        syncParams = params, collection = params.collection;
        let initialData = loadFromStorage(storageKey, storage);
        initialData.size > 0 && (begin(), initialData.forEach((storedItem) => {
          validateJsonSerializable(storedItem.data, "load"), write({ type: "insert", value: storedItem.data });
        }), commit()), lastKnownData.clear(), initialData.forEach((storedItem, key) => {
          lastKnownData.set(key, storedItem);
        }), markReady();
        let handleStorageEvent = (event) => {
          event.key !== storageKey || event.storageArea !== storage || processStorageChanges();
        };
        storageEventApi.addEventListener("storage", handleStorageEvent);
      },
      /**
       * Get sync metadata - returns storage key information
       * @returns Object containing storage key and storage type metadata
       */
      getSyncMetadata: () => ({
        storageKey,
        storageType: storage === (typeof window < "u" ? window.localStorage : null) ? "localStorage" : "custom"
      }),
      // Manual trigger function for local updates
      manualTrigger: processStorageChanges,
      // Collection instance reference
      collection
    },
    confirmOperationsSync: (mutations) => {
      if (!syncParams)
        return;
      let { begin, write, commit } = syncParams;
      begin(), mutations.forEach((mutation) => {
        write({
          type: mutation.type,
          value: mutation.type === "delete" ? mutation.original : mutation.modified
        });
      }), commit();
    }
  };
}

// packages/db/dist/esm/query/builder/index.js
var BaseQueryBuilder = class _BaseQueryBuilder {
  constructor(query = {}) {
    this.query = {}, this.query = { ...query };
  }
  /**
   * Creates a CollectionRef or QueryRef from a source object
   * @param source - An object with a single key-value pair
   * @param context - Context string for error messages (e.g., "from clause", "join clause")
   * @returns A tuple of [alias, ref] where alias is the source key and ref is the created reference
   */
  _createRefForSource(source, context) {
    if (Object.keys(source).length !== 1)
      throw new OnlyOneSourceAllowedError(context);
    let alias = Object.keys(source)[0], sourceValue = source[alias], ref;
    if (sourceValue instanceof CollectionImpl)
      ref = new CollectionRef(sourceValue, alias);
    else if (sourceValue instanceof _BaseQueryBuilder) {
      let subQuery = sourceValue._getQuery();
      if (!subQuery.from)
        throw new SubQueryMustHaveFromClauseError(context);
      ref = new QueryRef(subQuery, alias);
    } else
      throw new InvalidSourceError(alias);
    return [alias, ref];
  }
  /**
   * Specify the source table or subquery for the query
   *
   * @param source - An object with a single key-value pair where the key is the table alias and the value is a Collection or subquery
   * @returns A QueryBuilder with the specified source
   *
   * @example
   * ```ts
   * // Query from a collection
   * query.from({ users: usersCollection })
   *
   * // Query from a subquery
   * const activeUsers = query.from({ u: usersCollection }).where(({u}) => u.active)
   * query.from({ activeUsers })
   * ```
   */
  from(source) {
    let [, from] = this._createRefForSource(source, "from clause");
    return new _BaseQueryBuilder({
      ...this.query,
      from
    });
  }
  /**
   * Join another table or subquery to the current query
   *
   * @param source - An object with a single key-value pair where the key is the table alias and the value is a Collection or subquery
   * @param onCallback - A function that receives table references and returns the join condition
   * @param type - The type of join: 'inner', 'left', 'right', or 'full' (defaults to 'left')
   * @returns A QueryBuilder with the joined table available
   *
   * @example
   * ```ts
   * // Left join users with posts
   * query
   *   .from({ users: usersCollection })
   *   .join({ posts: postsCollection }, ({users, posts}) => eq(users.id, posts.userId))
   *
   * // Inner join with explicit type
   * query
   *   .from({ u: usersCollection })
   *   .join({ p: postsCollection }, ({u, p}) => eq(u.id, p.userId), 'inner')
   * ```
   *
   * // Join with a subquery
   * const activeUsers = query.from({ u: usersCollection }).where(({u}) => u.active)
   * query
   *   .from({ activeUsers })
   *   .join({ p: postsCollection }, ({u, p}) => eq(u.id, p.userId))
   */
  join(source, onCallback, type = "left") {
    let [alias, from] = this._createRefForSource(source, "join clause"), newAliases = [...this._getCurrentAliases(), alias], refProxy = createRefProxy(newAliases), onExpression = onCallback(refProxy), left, right;
    if (onExpression.type === "func" && onExpression.name === "eq" && onExpression.args.length === 2)
      left = onExpression.args[0], right = onExpression.args[1];
    else
      throw new JoinConditionMustBeEqualityError();
    let joinClause = {
      from,
      type,
      left,
      right
    }, existingJoins = this.query.join || [];
    return new _BaseQueryBuilder({
      ...this.query,
      join: [...existingJoins, joinClause]
    });
  }
  /**
   * Perform a LEFT JOIN with another table or subquery
   *
   * @param source - An object with a single key-value pair where the key is the table alias and the value is a Collection or subquery
   * @param onCallback - A function that receives table references and returns the join condition
   * @returns A QueryBuilder with the left joined table available
   *
   * @example
   * ```ts
   * // Left join users with posts
   * query
   *   .from({ users: usersCollection })
   *   .leftJoin({ posts: postsCollection }, ({users, posts}) => eq(users.id, posts.userId))
   * ```
   */
  leftJoin(source, onCallback) {
    return this.join(source, onCallback, "left");
  }
  /**
   * Perform a RIGHT JOIN with another table or subquery
   *
   * @param source - An object with a single key-value pair where the key is the table alias and the value is a Collection or subquery
   * @param onCallback - A function that receives table references and returns the join condition
   * @returns A QueryBuilder with the right joined table available
   *
   * @example
   * ```ts
   * // Right join users with posts
   * query
   *   .from({ users: usersCollection })
   *   .rightJoin({ posts: postsCollection }, ({users, posts}) => eq(users.id, posts.userId))
   * ```
   */
  rightJoin(source, onCallback) {
    return this.join(source, onCallback, "right");
  }
  /**
   * Perform an INNER JOIN with another table or subquery
   *
   * @param source - An object with a single key-value pair where the key is the table alias and the value is a Collection or subquery
   * @param onCallback - A function that receives table references and returns the join condition
   * @returns A QueryBuilder with the inner joined table available
   *
   * @example
   * ```ts
   * // Inner join users with posts
   * query
   *   .from({ users: usersCollection })
   *   .innerJoin({ posts: postsCollection }, ({users, posts}) => eq(users.id, posts.userId))
   * ```
   */
  innerJoin(source, onCallback) {
    return this.join(source, onCallback, "inner");
  }
  /**
   * Perform a FULL JOIN with another table or subquery
   *
   * @param source - An object with a single key-value pair where the key is the table alias and the value is a Collection or subquery
   * @param onCallback - A function that receives table references and returns the join condition
   * @returns A QueryBuilder with the full joined table available
   *
   * @example
   * ```ts
   * // Full join users with posts
   * query
   *   .from({ users: usersCollection })
   *   .fullJoin({ posts: postsCollection }, ({users, posts}) => eq(users.id, posts.userId))
   * ```
   */
  fullJoin(source, onCallback) {
    return this.join(source, onCallback, "full");
  }
  /**
   * Filter rows based on a condition
   *
   * @param callback - A function that receives table references and returns an expression
   * @returns A QueryBuilder with the where condition applied
   *
   * @example
   * ```ts
   * // Simple condition
   * query
   *   .from({ users: usersCollection })
   *   .where(({users}) => gt(users.age, 18))
   *
   * // Multiple conditions
   * query
   *   .from({ users: usersCollection })
   *   .where(({users}) => and(
   *     gt(users.age, 18),
   *     eq(users.active, true)
   *   ))
   *
   * // Multiple where calls are ANDed together
   * query
   *   .from({ users: usersCollection })
   *   .where(({users}) => gt(users.age, 18))
   *   .where(({users}) => eq(users.active, true))
   * ```
   */
  where(callback) {
    let aliases = this._getCurrentAliases(), refProxy = createRefProxy(aliases), expression = callback(refProxy), existingWhere = this.query.where || [];
    return new _BaseQueryBuilder({
      ...this.query,
      where: [...existingWhere, expression]
    });
  }
  /**
   * Filter grouped rows based on aggregate conditions
   *
   * @param callback - A function that receives table references and returns an expression
   * @returns A QueryBuilder with the having condition applied
   *
   * @example
   * ```ts
   * // Filter groups by count
   * query
   *   .from({ posts: postsCollection })
   *   .groupBy(({posts}) => posts.userId)
   *   .having(({posts}) => gt(count(posts.id), 5))
   *
   * // Filter by average
   * query
   *   .from({ orders: ordersCollection })
   *   .groupBy(({orders}) => orders.customerId)
   *   .having(({orders}) => gt(avg(orders.total), 100))
   *
   * // Multiple having calls are ANDed together
   * query
   *   .from({ orders: ordersCollection })
   *   .groupBy(({orders}) => orders.customerId)
   *   .having(({orders}) => gt(count(orders.id), 5))
   *   .having(({orders}) => gt(avg(orders.total), 100))
   * ```
   */
  having(callback) {
    let aliases = this._getCurrentAliases(), refProxy = createRefProxy(aliases), expression = callback(refProxy), existingHaving = this.query.having || [];
    return new _BaseQueryBuilder({
      ...this.query,
      having: [...existingHaving, expression]
    });
  }
  /**
   * Select specific columns or computed values from the query
   *
   * @param callback - A function that receives table references and returns an object with selected fields or expressions
   * @returns A QueryBuilder that returns only the selected fields
   *
   * @example
   * ```ts
   * // Select specific columns
   * query
   *   .from({ users: usersCollection })
   *   .select(({users}) => ({
   *     name: users.name,
   *     email: users.email
   *   }))
   *
   * // Select with computed values
   * query
   *   .from({ users: usersCollection })
   *   .select(({users}) => ({
   *     fullName: concat(users.firstName, ' ', users.lastName),
   *     ageInMonths: mul(users.age, 12)
   *   }))
   *
   * // Select with aggregates (requires GROUP BY)
   * query
   *   .from({ posts: postsCollection })
   *   .groupBy(({posts}) => posts.userId)
   *   .select(({posts, count}) => ({
   *     userId: posts.userId,
   *     postCount: count(posts.id)
   *   }))
   * ```
   */
  select(callback) {
    let aliases = this._getCurrentAliases(), refProxy = createRefProxy(aliases), selectObject = callback(refProxy), select = buildNestedSelect(selectObject);
    return new _BaseQueryBuilder({
      ...this.query,
      select,
      fnSelect: void 0
      // remove the fnSelect clause if it exists
    });
  }
  /**
   * Sort the query results by one or more columns
   *
   * @param callback - A function that receives table references and returns the field to sort by
   * @param direction - Sort direction: 'asc' for ascending, 'desc' for descending (defaults to 'asc')
   * @returns A QueryBuilder with the ordering applied
   *
   * @example
   * ```ts
   * // Sort by a single column
   * query
   *   .from({ users: usersCollection })
   *   .orderBy(({users}) => users.name)
   *
   * // Sort descending
   * query
   *   .from({ users: usersCollection })
   *   .orderBy(({users}) => users.createdAt, 'desc')
   *
   * // Multiple sorts (chain orderBy calls)
   * query
   *   .from({ users: usersCollection })
   *   .orderBy(({users}) => users.lastName)
   *   .orderBy(({users}) => users.firstName)
   * ```
   */
  orderBy(callback, options = "asc") {
    let aliases = this._getCurrentAliases(), refProxy = createRefProxy(aliases), result = callback(refProxy), opts = typeof options == "string" ? { direction: options, nulls: "first", stringSort: "locale" } : {
      direction: options.direction ?? "asc",
      nulls: options.nulls ?? "first",
      stringSort: options.stringSort ?? "locale",
      locale: options.stringSort === "locale" ? options.locale : void 0,
      localeOptions: options.stringSort === "locale" ? options.localeOptions : void 0
    }, makeOrderByClause = (res) => ({
      expression: toExpression(res),
      compareOptions: opts
    }), orderByClauses = Array.isArray(result) ? result.map((r) => makeOrderByClause(r)) : [makeOrderByClause(result)], existingOrderBy = this.query.orderBy || [];
    return new _BaseQueryBuilder({
      ...this.query,
      orderBy: [...existingOrderBy, ...orderByClauses]
    });
  }
  /**
   * Group rows by one or more columns for aggregation
   *
   * @param callback - A function that receives table references and returns the field(s) to group by
   * @returns A QueryBuilder with grouping applied (enables aggregate functions in SELECT and HAVING)
   *
   * @example
   * ```ts
   * // Group by a single column
   * query
   *   .from({ posts: postsCollection })
   *   .groupBy(({posts}) => posts.userId)
   *   .select(({posts, count}) => ({
   *     userId: posts.userId,
   *     postCount: count()
   *   }))
   *
   * // Group by multiple columns
   * query
   *   .from({ sales: salesCollection })
   *   .groupBy(({sales}) => [sales.region, sales.category])
   *   .select(({sales, sum}) => ({
   *     region: sales.region,
   *     category: sales.category,
   *     totalSales: sum(sales.amount)
   *   }))
   * ```
   */
  groupBy(callback) {
    let aliases = this._getCurrentAliases(), refProxy = createRefProxy(aliases), result = callback(refProxy), newExpressions = Array.isArray(result) ? result.map((r) => toExpression(r)) : [toExpression(result)], existingGroupBy = this.query.groupBy || [];
    return new _BaseQueryBuilder({
      ...this.query,
      groupBy: [...existingGroupBy, ...newExpressions]
    });
  }
  /**
   * Limit the number of rows returned by the query
   * `orderBy` is required for `limit`
   *
   * @param count - Maximum number of rows to return
   * @returns A QueryBuilder with the limit applied
   *
   * @example
   * ```ts
   * // Get top 5 posts by likes
   * query
   *   .from({ posts: postsCollection })
   *   .orderBy(({posts}) => posts.likes, 'desc')
   *   .limit(5)
   * ```
   */
  limit(count3) {
    return new _BaseQueryBuilder({
      ...this.query,
      limit: count3
    });
  }
  /**
   * Skip a number of rows before returning results
   * `orderBy` is required for `offset`
   *
   * @param count - Number of rows to skip
   * @returns A QueryBuilder with the offset applied
   *
   * @example
   * ```ts
   * // Get second page of results
   * query
   *   .from({ posts: postsCollection })
   *   .orderBy(({posts}) => posts.createdAt, 'desc')
   *   .offset(page * pageSize)
   *   .limit(pageSize)
   * ```
   */
  offset(count3) {
    return new _BaseQueryBuilder({
      ...this.query,
      offset: count3
    });
  }
  /**
   * Specify that the query should return distinct rows.
   * Deduplicates rows based on the selected columns.
   * @returns A QueryBuilder with distinct enabled
   *
   * @example
   * ```ts
   * // Get countries our users are from
   * query
   *   .from({ users: usersCollection })
   *   .select(({users}) => users.country)
   *   .distinct()
   * ```
   */
  distinct() {
    return new _BaseQueryBuilder({
      ...this.query,
      distinct: !0
    });
  }
  /**
   * Specify that the query should return a single result
   * @returns A QueryBuilder that returns the first result
   *
   * @example
   * ```ts
   * // Get the user matching the query
   * query
   *   .from({ users: usersCollection })
   *   .where(({users}) => eq(users.id, 1))
   *   .findOne()
   *```
   */
  findOne() {
    return new _BaseQueryBuilder({
      ...this.query,
      // TODO: enforcing return only one result with also a default orderBy if none is specified
      // limit: 1,
      singleResult: !0
    });
  }
  // Helper methods
  _getCurrentAliases() {
    let aliases = [];
    if (this.query.from && aliases.push(this.query.from.alias), this.query.join)
      for (let join2 of this.query.join)
        aliases.push(join2.from.alias);
    return aliases;
  }
  /**
   * Functional variants of the query builder
   * These are imperative function that are called for ery row.
   * Warning: that these cannot be optimized by the query compiler, and may prevent
   * some type of optimizations being possible.
   * @example
   * ```ts
   * q.fn.select((row) => ({
   *   name: row.user.name.toUpperCase(),
   *   age: row.user.age + 1,
   * }))
   * ```
   */
  get fn() {
    let builder = this;
    return {
      /**
       * Select fields using a function that operates on each row
       * Warning: This cannot be optimized by the query compiler
       *
       * @param callback - A function that receives a row and returns the selected value
       * @returns A QueryBuilder with functional selection applied
       *
       * @example
       * ```ts
       * // Functional select (not optimized)
       * query
       *   .from({ users: usersCollection })
       *   .fn.select(row => ({
       *     name: row.users.name.toUpperCase(),
       *     age: row.users.age + 1,
       *   }))
       * ```
       */
      select(callback) {
        return new _BaseQueryBuilder({
          ...builder.query,
          select: void 0,
          // remove the select clause if it exists
          fnSelect: callback
        });
      },
      /**
       * Filter rows using a function that operates on each row
       * Warning: This cannot be optimized by the query compiler
       *
       * @param callback - A function that receives a row and returns a boolean
       * @returns A QueryBuilder with functional filtering applied
       *
       * @example
       * ```ts
       * // Functional where (not optimized)
       * query
       *   .from({ users: usersCollection })
       *   .fn.where(row => row.users.name.startsWith('A'))
       * ```
       */
      where(callback) {
        return new _BaseQueryBuilder({
          ...builder.query,
          fnWhere: [
            ...builder.query.fnWhere || [],
            callback
          ]
        });
      },
      /**
       * Filter grouped rows using a function that operates on each aggregated row
       * Warning: This cannot be optimized by the query compiler
       *
       * @param callback - A function that receives an aggregated row and returns a boolean
       * @returns A QueryBuilder with functional having filter applied
       *
       * @example
       * ```ts
       * // Functional having (not optimized)
       * query
       *   .from({ posts: postsCollection })
       *   .groupBy(({posts}) => posts.userId)
       *   .fn.having(row => row.count > 5)
       * ```
       */
      having(callback) {
        return new _BaseQueryBuilder({
          ...builder.query,
          fnHaving: [
            ...builder.query.fnHaving || [],
            callback
          ]
        });
      }
    };
  }
  _getQuery() {
    if (!this.query.from)
      throw new QueryMustHaveFromClauseError();
    return this.query;
  }
};
function toExpr(value) {
  return value === void 0 ? toExpression(null) : value instanceof Aggregate || value instanceof Func || value instanceof PropRef || value instanceof Value ? value : toExpression(value);
}
function isPlainObject(value) {
  return value !== null && typeof value == "object" && !isExpressionLike(value) && !value.__refProxy;
}
function buildNestedSelect(obj) {
  if (!isPlainObject(obj)) return toExpr(obj);
  let out = {};
  for (let [k, v] of Object.entries(obj)) {
    if (typeof k == "string" && k.startsWith("__SPREAD_SENTINEL__")) {
      out[k] = v;
      continue;
    }
    out[k] = buildNestedSelect(v);
  }
  return out;
}
function buildQuery(fn) {
  let result = fn(new BaseQueryBuilder());
  return getQueryIR(result);
}
function getQueryIR(builder) {
  return builder._getQuery();
}
var Query = BaseQueryBuilder;

// packages/db/dist/esm/query/compiler/index.js
import { map as map4, filter as filter3, distinct } from "@tanstack/db-ivm";

// packages/db/dist/esm/query/compiler/expressions.js
var SUPPORTED_COLLECTION_FUNCS = /* @__PURE__ */ new Set([
  "eq",
  "gt",
  "lt",
  "gte",
  "lte",
  "and",
  "or",
  "in"
]);
function isConvertibleToCollectionFilter(whereClause) {
  let tpe = whereClause.type;
  return tpe === "func" ? SUPPORTED_COLLECTION_FUNCS.has(whereClause.name) ? whereClause.args.every(
    (arg) => isConvertibleToCollectionFilter(arg)
  ) : !1 : ["val", "ref"].includes(tpe);
}
function convertToBasicExpression(whereClause, collectionAlias) {
  let tpe = whereClause.type;
  if (tpe === "val")
    return new Value(whereClause.value);
  if (tpe === "ref") {
    let path = whereClause.path;
    if (Array.isArray(path)) {
      if (path[0] === collectionAlias && path.length > 1)
        return new PropRef(path.slice(1));
      if (path.length === 1 && path[0] !== void 0)
        return new PropRef([path[0]]);
    }
    return new PropRef(Array.isArray(path) ? path : [String(path)]);
  } else {
    if (!SUPPORTED_COLLECTION_FUNCS.has(whereClause.name))
      return null;
    let args = [];
    for (let arg of whereClause.args) {
      let convertedArg = convertToBasicExpression(
        arg,
        collectionAlias
      );
      if (convertedArg == null)
        return null;
      args.push(convertedArg);
    }
    return new Func(whereClause.name, args);
  }
}
function convertOrderByToBasicExpression(orderBy, collectionAlias) {
  return orderBy.map((clause) => {
    let basicExp = convertToBasicExpression(
      clause.expression,
      collectionAlias
    );
    if (!basicExp)
      throw new Error(
        `Failed to convert orderBy expression to a basic expression: ${clause.expression}`
      );
    return {
      ...clause,
      expression: basicExp
    };
  });
}

// packages/db/dist/esm/query/optimizer.js
function optimizeQuery(query) {
  let sourceWhereClauses = extractSourceWhereClauses(query), optimized = query, previousOptimized, iterations = 0, maxIterations = 10;
  for (; iterations < maxIterations && !deepEquals(optimized, previousOptimized); )
    previousOptimized = optimized, optimized = applyRecursiveOptimization(optimized), iterations++;
  return {
    optimizedQuery: removeRedundantSubqueries(optimized),
    sourceWhereClauses
  };
}
function extractSourceWhereClauses(query) {
  let sourceWhereClauses = /* @__PURE__ */ new Map();
  if (!query.where || query.where.length === 0)
    return sourceWhereClauses;
  let analyzedClauses = splitAndClauses(query.where).map(
    (clause) => analyzeWhereClause(clause)
  ), groupedClauses = groupWhereClauses(analyzedClauses);
  for (let [sourceAlias, whereClause] of groupedClauses.singleSource)
    isCollectionReference(query, sourceAlias) && isConvertibleToCollectionFilter(whereClause) && sourceWhereClauses.set(sourceAlias, whereClause);
  return sourceWhereClauses;
}
function isCollectionReference(query, sourceAlias) {
  if (query.from.alias === sourceAlias)
    return query.from.type === "collectionRef";
  if (query.join) {
    for (let joinClause of query.join)
      if (joinClause.from.alias === sourceAlias)
        return joinClause.from.type === "collectionRef";
  }
  return !1;
}
function applyRecursiveOptimization(query) {
  let subqueriesOptimized = {
    ...query,
    from: query.from.type === "queryRef" ? new QueryRef(
      applyRecursiveOptimization(query.from.query),
      query.from.alias
    ) : query.from,
    join: query.join?.map((joinClause) => ({
      ...joinClause,
      from: joinClause.from.type === "queryRef" ? new QueryRef(
        applyRecursiveOptimization(joinClause.from.query),
        joinClause.from.alias
      ) : joinClause.from
    }))
  };
  return applySingleLevelOptimization(subqueriesOptimized);
}
function applySingleLevelOptimization(query) {
  if (!query.where || query.where.length === 0 || !query.join || query.join.length === 0)
    return query;
  let nonResidualWhereClauses = query.where.filter(
    (where) => !isResidualWhere(where)
  ), analyzedClauses = splitAndClauses(nonResidualWhereClauses).map(
    (clause) => analyzeWhereClause(clause)
  ), groupedClauses = groupWhereClauses(analyzedClauses), optimizedQuery = applyOptimizations(query, groupedClauses), residualWhereClauses = query.where.filter(
    (where) => isResidualWhere(where)
  );
  return residualWhereClauses.length > 0 && (optimizedQuery.where = [
    ...optimizedQuery.where || [],
    ...residualWhereClauses
  ]), optimizedQuery;
}
function removeRedundantSubqueries(query) {
  return {
    ...query,
    from: removeRedundantFromClause(query.from),
    join: query.join?.map((joinClause) => ({
      ...joinClause,
      from: removeRedundantFromClause(joinClause.from)
    }))
  };
}
function removeRedundantFromClause(from) {
  if (from.type === "collectionRef")
    return from;
  let processedQuery = removeRedundantSubqueries(from.query);
  if (isRedundantSubquery(processedQuery)) {
    let innerFrom = removeRedundantFromClause(processedQuery.from);
    return innerFrom.type === "collectionRef" ? new CollectionRef(innerFrom.collection, from.alias) : new QueryRef(innerFrom.query, from.alias);
  }
  return new QueryRef(processedQuery, from.alias);
}
function isRedundantSubquery(query) {
  return (!query.where || query.where.length === 0) && !query.select && (!query.groupBy || query.groupBy.length === 0) && (!query.having || query.having.length === 0) && (!query.orderBy || query.orderBy.length === 0) && (!query.join || query.join.length === 0) && query.limit === void 0 && query.offset === void 0 && !query.fnSelect && (!query.fnWhere || query.fnWhere.length === 0) && (!query.fnHaving || query.fnHaving.length === 0);
}
function splitAndClauses(whereClauses) {
  let result = [];
  for (let whereClause of whereClauses) {
    let clause = getWhereExpression(whereClause);
    result.push(...splitAndClausesRecursive(clause));
  }
  return result;
}
function splitAndClausesRecursive(clause) {
  if (clause.type === "func" && clause.name === "and") {
    let result = [];
    for (let arg of clause.args)
      result.push(...splitAndClausesRecursive(arg));
    return result;
  } else
    return [clause];
}
function analyzeWhereClause(clause) {
  let touchedSources = /* @__PURE__ */ new Set(), hasNamespaceOnlyRef = !1;
  function collectSources(expr) {
    switch (expr.type) {
      case "ref":
        if (expr.path && expr.path.length > 0) {
          let firstElement = expr.path[0];
          firstElement && (touchedSources.add(firstElement), expr.path.length === 1 && (hasNamespaceOnlyRef = !0));
        }
        break;
      case "func":
        expr.args && expr.args.forEach(collectSources);
        break;
      case "val":
        break;
      case "agg":
        expr.args && expr.args.forEach(collectSources);
        break;
    }
  }
  return collectSources(clause), {
    expression: clause,
    touchedSources,
    hasNamespaceOnlyRef
  };
}
function groupWhereClauses(analyzedClauses) {
  let singleSource = /* @__PURE__ */ new Map(), multiSource = [];
  for (let clause of analyzedClauses)
    if (clause.touchedSources.size === 1 && !clause.hasNamespaceOnlyRef) {
      let source = Array.from(clause.touchedSources)[0];
      singleSource.has(source) || singleSource.set(source, []), singleSource.get(source).push(clause.expression);
    } else (clause.touchedSources.size > 1 || clause.hasNamespaceOnlyRef) && multiSource.push(clause.expression);
  let combinedSingleSource = /* @__PURE__ */ new Map();
  for (let [source, clauses] of singleSource)
    combinedSingleSource.set(source, combineWithAnd(clauses));
  let combinedMultiSource = multiSource.length > 0 ? combineWithAnd(multiSource) : void 0;
  return {
    singleSource: combinedSingleSource,
    multiSource: combinedMultiSource
  };
}
function applyOptimizations(query, groupedClauses) {
  let actuallyOptimized = /* @__PURE__ */ new Set(), optimizedFrom = optimizeFromWithTracking(
    query.from,
    groupedClauses.singleSource,
    actuallyOptimized
  ), optimizedJoins = query.join ? query.join.map((joinClause) => ({
    ...joinClause,
    from: optimizeFromWithTracking(
      joinClause.from,
      groupedClauses.singleSource,
      actuallyOptimized
    )
  })) : void 0, remainingWhereClauses = [];
  groupedClauses.multiSource && remainingWhereClauses.push(groupedClauses.multiSource);
  let hasOuterJoins = query.join && query.join.some(
    (join2) => join2.type === "left" || join2.type === "right" || join2.type === "full"
  );
  for (let [source, clause] of groupedClauses.singleSource)
    actuallyOptimized.has(source) ? hasOuterJoins && remainingWhereClauses.push(createResidualWhere(clause)) : remainingWhereClauses.push(clause);
  return {
    // Copy all non-optimized fields as-is
    select: query.select,
    groupBy: query.groupBy ? [...query.groupBy] : void 0,
    having: query.having ? [...query.having] : void 0,
    orderBy: query.orderBy ? [...query.orderBy] : void 0,
    limit: query.limit,
    offset: query.offset,
    distinct: query.distinct,
    fnSelect: query.fnSelect,
    fnWhere: query.fnWhere ? [...query.fnWhere] : void 0,
    fnHaving: query.fnHaving ? [...query.fnHaving] : void 0,
    // Use the optimized FROM and JOIN clauses
    from: optimizedFrom,
    join: optimizedJoins,
    // Only include WHERE clauses that weren't successfully optimized
    where: remainingWhereClauses.length > 0 ? remainingWhereClauses : []
  };
}
function deepCopyQuery(query) {
  return {
    // Recursively copy the FROM clause
    from: query.from.type === "collectionRef" ? new CollectionRef(query.from.collection, query.from.alias) : new QueryRef(deepCopyQuery(query.from.query), query.from.alias),
    // Copy all other fields, creating new arrays where necessary
    select: query.select,
    join: query.join ? query.join.map((joinClause) => ({
      type: joinClause.type,
      left: joinClause.left,
      right: joinClause.right,
      from: joinClause.from.type === "collectionRef" ? new CollectionRef(
        joinClause.from.collection,
        joinClause.from.alias
      ) : new QueryRef(
        deepCopyQuery(joinClause.from.query),
        joinClause.from.alias
      )
    })) : void 0,
    where: query.where ? [...query.where] : void 0,
    groupBy: query.groupBy ? [...query.groupBy] : void 0,
    having: query.having ? [...query.having] : void 0,
    orderBy: query.orderBy ? [...query.orderBy] : void 0,
    limit: query.limit,
    offset: query.offset,
    fnSelect: query.fnSelect,
    fnWhere: query.fnWhere ? [...query.fnWhere] : void 0,
    fnHaving: query.fnHaving ? [...query.fnHaving] : void 0
  };
}
function optimizeFromWithTracking(from, singleSourceClauses, actuallyOptimized) {
  let whereClause = singleSourceClauses.get(from.alias);
  if (!whereClause)
    return from.type === "collectionRef" ? new CollectionRef(from.collection, from.alias) : new QueryRef(deepCopyQuery(from.query), from.alias);
  if (from.type === "collectionRef") {
    let subQuery = {
      from: new CollectionRef(from.collection, from.alias),
      where: [whereClause]
    };
    return actuallyOptimized.add(from.alias), new QueryRef(subQuery, from.alias);
  }
  if (!isSafeToPushIntoExistingSubquery(from.query, whereClause, from.alias))
    return new QueryRef(deepCopyQuery(from.query), from.alias);
  if (referencesAliasWithRemappedSelect(from.query, whereClause, from.alias))
    return new QueryRef(deepCopyQuery(from.query), from.alias);
  let existingWhere = from.query.where || [], optimizedSubQuery = {
    ...deepCopyQuery(from.query),
    where: [...existingWhere, whereClause]
  };
  return actuallyOptimized.add(from.alias), new QueryRef(optimizedSubQuery, from.alias);
}
function unsafeSelect(query, whereClause, outerAlias) {
  return query.select ? selectHasAggregates(query.select) || whereReferencesComputedSelectFields(query.select, whereClause, outerAlias) : !1;
}
function unsafeGroupBy(query) {
  return query.groupBy && query.groupBy.length > 0;
}
function unsafeHaving(query) {
  return query.having && query.having.length > 0;
}
function unsafeOrderBy(query) {
  return query.orderBy && query.orderBy.length > 0 && (query.limit !== void 0 || query.offset !== void 0);
}
function unsafeFnSelect(query) {
  return query.fnSelect || query.fnWhere && query.fnWhere.length > 0 || query.fnHaving && query.fnHaving.length > 0;
}
function isSafeToPushIntoExistingSubquery(query, whereClause, outerAlias) {
  return !(unsafeSelect(query, whereClause, outerAlias) || unsafeGroupBy(query) || unsafeHaving(query) || unsafeOrderBy(query) || unsafeFnSelect(query));
}
function selectHasAggregates(select) {
  for (let value of Object.values(select))
    if (typeof value == "object") {
      let v = value;
      if (v.type === "agg" || !("type" in v) && selectHasAggregates(v))
        return !0;
    }
  return !1;
}
function collectRefs(expr) {
  let refs = [];
  if (expr == null || typeof expr != "object") return refs;
  switch (expr.type) {
    case "ref":
      refs.push(expr);
      break;
    case "func":
    case "agg":
      for (let arg of expr.args ?? [])
        refs.push(...collectRefs(arg));
      break;
  }
  return refs;
}
function whereReferencesComputedSelectFields(select, whereClause, outerAlias) {
  let computed = /* @__PURE__ */ new Set();
  for (let [key, value] of Object.entries(select))
    key.startsWith("__SPREAD_SENTINEL__") || value instanceof PropRef || computed.add(key);
  let refs = collectRefs(whereClause);
  for (let ref of refs) {
    let path = ref.path;
    if (!Array.isArray(path) || path.length < 2) continue;
    let alias = path[0], field = path[1];
    if (alias === outerAlias && computed.has(field))
      return !0;
  }
  return !1;
}
function referencesAliasWithRemappedSelect(subquery, whereClause, outerAlias) {
  let refs = collectRefs(whereClause);
  if (refs.every((ref) => ref.path[0] !== outerAlias))
    return !1;
  if (subquery.fnSelect)
    return !0;
  let select = subquery.select;
  if (!select)
    return !1;
  for (let ref of refs) {
    let path = ref.path;
    if (path.length < 2 || path[0] !== outerAlias) continue;
    let projected = select[path[1]];
    if (!projected) continue;
    if (!(projected instanceof PropRef) || projected.path.length < 2)
      return !0;
    let [innerAlias, innerField] = projected.path;
    if (innerAlias !== outerAlias && innerAlias !== subquery.from.alias || innerField !== path[1])
      return !0;
  }
  return !1;
}
function combineWithAnd(expressions) {
  if (expressions.length === 0)
    throw new CannotCombineEmptyExpressionListError();
  return expressions.length === 1 ? expressions[0] : new Func("and", expressions);
}

// packages/db/dist/esm/query/compiler/joins.js
import { map, tap, join, filter } from "@tanstack/db-ivm";
function processJoins(pipeline, joinClauses, sources, mainCollectionId, mainSource, allInputs, cache, queryMapping, collections, subscriptions, callbacks, lazySources, optimizableOrderByCollections, setWindowFn, rawQuery, onCompileSubquery, aliasToCollectionId, aliasRemapping) {
  let resultPipeline = pipeline;
  for (let joinClause of joinClauses)
    resultPipeline = processJoin(
      resultPipeline,
      joinClause,
      sources,
      mainCollectionId,
      mainSource,
      allInputs,
      cache,
      queryMapping,
      collections,
      subscriptions,
      callbacks,
      lazySources,
      optimizableOrderByCollections,
      setWindowFn,
      rawQuery,
      onCompileSubquery,
      aliasToCollectionId,
      aliasRemapping
    );
  return resultPipeline;
}
function processJoin(pipeline, joinClause, sources, mainCollectionId, mainSource, allInputs, cache, queryMapping, collections, subscriptions, callbacks, lazySources, optimizableOrderByCollections, setWindowFn, rawQuery, onCompileSubquery, aliasToCollectionId, aliasRemapping) {
  let isCollectionRef = joinClause.from.type === "collectionRef", {
    alias: joinedSource,
    input: joinedInput,
    collectionId: joinedCollectionId
  } = processJoinSource(
    joinClause.from,
    allInputs,
    collections,
    subscriptions,
    callbacks,
    lazySources,
    optimizableOrderByCollections,
    setWindowFn,
    cache,
    queryMapping,
    onCompileSubquery,
    aliasToCollectionId,
    aliasRemapping
  );
  sources[joinedSource] = joinedInput, isCollectionRef && (aliasToCollectionId[joinedSource] = joinedCollectionId);
  let mainCollection = collections[mainCollectionId], joinedCollection = collections[joinedCollectionId];
  if (!mainCollection)
    throw new JoinCollectionNotFoundError(mainCollectionId);
  if (!joinedCollection)
    throw new JoinCollectionNotFoundError(joinedCollectionId);
  let { activeSource, lazySource } = getActiveAndLazySources(
    joinClause.type,
    mainCollection,
    joinedCollection
  ), availableSources = Object.keys(sources), { mainExpr, joinedExpr } = analyzeJoinExpressions(
    joinClause.left,
    joinClause.right,
    availableSources,
    joinedSource
  ), compiledMainExpr = compileExpression(mainExpr), compiledJoinedExpr = compileExpression(joinedExpr), mainPipeline = pipeline.pipe(
    map(([currentKey, namespacedRow]) => [compiledMainExpr(namespacedRow), [currentKey, namespacedRow]])
  ), joinedPipeline = joinedInput.pipe(
    map(([currentKey, row]) => {
      let namespacedRow = { [joinedSource]: row };
      return [compiledJoinedExpr(namespacedRow), [currentKey, namespacedRow]];
    })
  );
  if (!["inner", "left", "right", "full"].includes(joinClause.type))
    throw new UnsupportedJoinTypeError(joinClause.type);
  if (activeSource) {
    let lazyFrom = activeSource === "main" ? joinClause.from : rawQuery.from, limitedSubquery = lazyFrom.type === "queryRef" && (lazyFrom.query.limit || lazyFrom.query.offset), hasComputedJoinExpr = mainExpr.type === "func" || joinedExpr.type === "func";
    if (!limitedSubquery && !hasComputedJoinExpr) {
      let lazyAlias = activeSource === "main" ? joinedSource : mainSource;
      lazySources.add(lazyAlias);
      let activePipeline = activeSource === "main" ? mainPipeline : joinedPipeline, followRefResult = followRef(
        rawQuery,
        activeSource === "main" ? joinedExpr : mainExpr,
        lazySource
      ), followRefCollection = followRefResult.collection, fieldName = followRefResult.path[0];
      fieldName && ensureIndexForField(
        fieldName,
        followRefResult.path,
        followRefCollection
      );
      let activePipelineWithLoading = activePipeline.pipe(
        tap((data) => {
          let resolvedAlias = aliasRemapping[lazyAlias] || lazyAlias, lazySourceSubscription = subscriptions[resolvedAlias];
          if (!lazySourceSubscription)
            throw new SubscriptionNotFoundError(
              resolvedAlias,
              lazyAlias,
              lazySource.id,
              Object.keys(subscriptions)
            );
          if (lazySourceSubscription.hasLoadedInitialState())
            return;
          let joinKeys = data.getInner().map(([[joinKey]]) => joinKey), lazyJoinRef = new PropRef(followRefResult.path);
          lazySourceSubscription.requestSnapshot({
            where: inArray(lazyJoinRef, joinKeys),
            optimizedOnly: !0
          }) || lazySourceSubscription.requestSnapshot();
        })
      );
      activeSource === "main" ? mainPipeline = activePipelineWithLoading : joinedPipeline = activePipelineWithLoading;
    }
  }
  return mainPipeline.pipe(
    join(joinedPipeline, joinClause.type),
    processJoinResults(joinClause.type)
  );
}
function analyzeJoinExpressions(left, right, allAvailableSourceAliases, joinedSource) {
  let availableSources = allAvailableSourceAliases.filter(
    (alias) => alias !== joinedSource
  ), leftSourceAlias = getSourceAliasFromExpression(left), rightSourceAlias = getSourceAliasFromExpression(right);
  if (leftSourceAlias && availableSources.includes(leftSourceAlias) && rightSourceAlias === joinedSource)
    return { mainExpr: left, joinedExpr: right };
  if (leftSourceAlias === joinedSource && rightSourceAlias && availableSources.includes(rightSourceAlias))
    return { mainExpr: right, joinedExpr: left };
  throw !leftSourceAlias || !rightSourceAlias ? new InvalidJoinConditionSourceMismatchError() : leftSourceAlias === rightSourceAlias ? new InvalidJoinConditionSameSourceError(leftSourceAlias) : availableSources.includes(leftSourceAlias) ? rightSourceAlias !== joinedSource ? new InvalidJoinConditionRightSourceError(joinedSource) : new InvalidJoinCondition() : new InvalidJoinConditionLeftSourceError(leftSourceAlias);
}
function getSourceAliasFromExpression(expr) {
  switch (expr.type) {
    case "ref":
      return expr.path[0] || null;
    case "func": {
      let sourceAliases = /* @__PURE__ */ new Set();
      for (let arg of expr.args) {
        let alias = getSourceAliasFromExpression(arg);
        alias && sourceAliases.add(alias);
      }
      return sourceAliases.size === 1 ? Array.from(sourceAliases)[0] : null;
    }
    default:
      return null;
  }
}
function processJoinSource(from, allInputs, collections, subscriptions, callbacks, lazySources, optimizableOrderByCollections, setWindowFn, cache, queryMapping, onCompileSubquery, aliasToCollectionId, aliasRemapping) {
  switch (from.type) {
    case "collectionRef": {
      let input = allInputs[from.alias];
      if (!input)
        throw new CollectionInputNotFoundError(
          from.alias,
          from.collection.id,
          Object.keys(allInputs)
        );
      return aliasToCollectionId[from.alias] = from.collection.id, { alias: from.alias, input, collectionId: from.collection.id };
    }
    case "queryRef": {
      let originalQuery = queryMapping.get(from.query) || from.query, subQueryResult = onCompileSubquery(
        originalQuery,
        allInputs,
        collections,
        subscriptions,
        callbacks,
        lazySources,
        optimizableOrderByCollections,
        setWindowFn,
        cache,
        queryMapping
      );
      Object.assign(aliasToCollectionId, subQueryResult.aliasToCollectionId), Object.assign(aliasRemapping, subQueryResult.aliasRemapping);
      let innerAlias = Object.keys(subQueryResult.aliasToCollectionId).find(
        (alias) => subQueryResult.aliasToCollectionId[alias] === subQueryResult.collectionId
      );
      innerAlias && innerAlias !== from.alias && (aliasRemapping[from.alias] = innerAlias);
      let extractedInput = subQueryResult.pipeline.pipe(
        map((data) => {
          let [key, [value, _orderByIndex]] = data;
          return [key, value];
        })
      );
      return {
        alias: from.alias,
        input: extractedInput,
        collectionId: subQueryResult.collectionId
      };
    }
    default:
      throw new UnsupportedJoinSourceTypeError(from.type);
  }
}
function processJoinResults(joinType) {
  return function(pipeline) {
    return pipeline.pipe(
      // Process the join result and handle nulls
      filter((result) => {
        let [_key, [main, joined]] = result, mainNamespacedRow = main?.[1], joinedNamespacedRow = joined?.[1];
        return joinType === "inner" ? !!(mainNamespacedRow && joinedNamespacedRow) : joinType === "left" ? !!mainNamespacedRow : joinType === "right" ? !!joinedNamespacedRow : !0;
      }),
      map((result) => {
        let [_key, [main, joined]] = result, mainKey = main?.[0], mainNamespacedRow = main?.[1], joinedKey = joined?.[0], joinedNamespacedRow = joined?.[1], mergedNamespacedRow = {};
        return mainNamespacedRow && Object.assign(mergedNamespacedRow, mainNamespacedRow), joinedNamespacedRow && Object.assign(mergedNamespacedRow, joinedNamespacedRow), [`[${mainKey},${joinedKey}]`, mergedNamespacedRow];
      })
    );
  };
}
function getActiveAndLazySources(joinType, leftCollection, rightCollection) {
  switch (joinType) {
    case "left":
      return { activeSource: "main", lazySource: rightCollection };
    case "right":
      return { activeSource: "joined", lazySource: leftCollection };
    case "inner":
      return leftCollection.size < rightCollection.size ? { activeSource: "main", lazySource: rightCollection } : { activeSource: "joined", lazySource: leftCollection };
    default:
      return { activeSource: void 0, lazySource: void 0 };
  }
}

// packages/db/dist/esm/query/compiler/group-by.js
import { groupBy, map as map2, filter as filter2, groupByOperators } from "@tanstack/db-ivm";
var { sum, count: count2, avg, min, max } = groupByOperators;
function validateAndCreateMapping(groupByClause, selectClause) {
  let selectToGroupByIndex = /* @__PURE__ */ new Map(), groupByExpressions = [...groupByClause];
  if (!selectClause)
    return { selectToGroupByIndex, groupByExpressions };
  for (let [alias, expr] of Object.entries(selectClause)) {
    if (expr.type === "agg")
      continue;
    let groupIndex = groupByExpressions.findIndex(
      (groupExpr) => expressionsEqual(expr, groupExpr)
    );
    if (groupIndex === -1)
      throw new NonAggregateExpressionNotInGroupByError(alias);
    selectToGroupByIndex.set(alias, groupIndex);
  }
  return { selectToGroupByIndex, groupByExpressions };
}
function processGroupBy(pipeline, groupByClause, havingClauses, selectClause, fnHavingClauses) {
  if (groupByClause.length === 0) {
    let aggregates2 = {};
    if (selectClause) {
      for (let [alias, expr] of Object.entries(selectClause))
        if (expr.type === "agg") {
          let aggExpr = expr;
          aggregates2[alias] = getAggregateFunction(aggExpr);
        }
    }
    let keyExtractor2 = () => ({ __singleGroup: !0 });
    if (pipeline = pipeline.pipe(
      groupBy(keyExtractor2, aggregates2)
    ), pipeline = pipeline.pipe(
      map2(([, aggregatedRow]) => {
        let finalResults = { ...aggregatedRow.__select_results || {} };
        if (selectClause)
          for (let [alias, expr] of Object.entries(selectClause))
            expr.type === "agg" && (finalResults[alias] = aggregatedRow[alias]);
        return [
          "single_group",
          {
            ...aggregatedRow,
            __select_results: finalResults
          }
        ];
      })
    ), havingClauses && havingClauses.length > 0)
      for (let havingClause of havingClauses) {
        let havingExpression = getHavingExpression(havingClause), transformedHavingClause = replaceAggregatesByRefs(
          havingExpression,
          selectClause || {}
        ), compiledHaving = compileExpression(transformedHavingClause);
        pipeline = pipeline.pipe(
          filter2(([, row]) => {
            let namespacedRow = { result: row.__select_results };
            return compiledHaving(namespacedRow);
          })
        );
      }
    if (fnHavingClauses && fnHavingClauses.length > 0)
      for (let fnHaving of fnHavingClauses)
        pipeline = pipeline.pipe(
          filter2(([, row]) => {
            let namespacedRow = { result: row.__select_results };
            return fnHaving(namespacedRow);
          })
        );
    return pipeline;
  }
  let mapping = validateAndCreateMapping(groupByClause, selectClause), compiledGroupByExpressions = groupByClause.map(
    (e) => compileExpression(e)
  ), keyExtractor = ([, row]) => {
    let namespacedRow = { ...row };
    delete namespacedRow.__select_results;
    let key = {};
    for (let i = 0; i < groupByClause.length; i++) {
      let compiledExpr = compiledGroupByExpressions[i], value = compiledExpr(namespacedRow);
      key[`__key_${i}`] = value;
    }
    return key;
  }, aggregates = {};
  if (selectClause) {
    for (let [alias, expr] of Object.entries(selectClause))
      if (expr.type === "agg") {
        let aggExpr = expr;
        aggregates[alias] = getAggregateFunction(aggExpr);
      }
  }
  if (pipeline = pipeline.pipe(groupBy(keyExtractor, aggregates)), pipeline = pipeline.pipe(
    map2(([, aggregatedRow]) => {
      let selectResults = aggregatedRow.__select_results || {}, finalResults = {};
      if (selectClause)
        for (let [alias, expr] of Object.entries(selectClause))
          if (expr.type !== "agg") {
            let groupIndex = mapping.selectToGroupByIndex.get(alias);
            groupIndex !== void 0 ? finalResults[alias] = aggregatedRow[`__key_${groupIndex}`] : finalResults[alias] = selectResults[alias];
          } else
            finalResults[alias] = aggregatedRow[alias];
      else
        for (let i = 0; i < groupByClause.length; i++)
          finalResults[`__key_${i}`] = aggregatedRow[`__key_${i}`];
      let finalKey;
      if (groupByClause.length === 1)
        finalKey = aggregatedRow.__key_0;
      else {
        let keyParts = [];
        for (let i = 0; i < groupByClause.length; i++)
          keyParts.push(aggregatedRow[`__key_${i}`]);
        finalKey = JSON.stringify(keyParts);
      }
      return [
        finalKey,
        {
          ...aggregatedRow,
          __select_results: finalResults
        }
      ];
    })
  ), havingClauses && havingClauses.length > 0)
    for (let havingClause of havingClauses) {
      let havingExpression = getHavingExpression(havingClause), transformedHavingClause = replaceAggregatesByRefs(
        havingExpression,
        selectClause || {}
      ), compiledHaving = compileExpression(transformedHavingClause);
      pipeline = pipeline.pipe(
        filter2(([, row]) => {
          let namespacedRow = { result: row.__select_results };
          return compiledHaving(namespacedRow);
        })
      );
    }
  if (fnHavingClauses && fnHavingClauses.length > 0)
    for (let fnHaving of fnHavingClauses)
      pipeline = pipeline.pipe(
        filter2(([, row]) => {
          let namespacedRow = { result: row.__select_results };
          return fnHaving(namespacedRow);
        })
      );
  return pipeline;
}
function expressionsEqual(expr1, expr2) {
  if (!expr1 || !expr2 || expr1.type !== expr2.type) return !1;
  switch (expr1.type) {
    case "ref":
      return !expr1.path || !expr2.path || expr1.path.length !== expr2.path.length ? !1 : expr1.path.every(
        (segment, i) => segment === expr2.path[i]
      );
    case "val":
      return expr1.value === expr2.value;
    case "func":
      return expr1.name === expr2.name && expr1.args?.length === expr2.args?.length && (expr1.args || []).every(
        (arg, i) => expressionsEqual(arg, expr2.args[i])
      );
    case "agg":
      return expr1.name === expr2.name && expr1.args?.length === expr2.args?.length && (expr1.args || []).every(
        (arg, i) => expressionsEqual(arg, expr2.args[i])
      );
    default:
      return !1;
  }
}
function getAggregateFunction(aggExpr) {
  let compiledExpr = compileExpression(aggExpr.args[0]), valueExtractor = ([, namespacedRow]) => {
    let value = compiledExpr(namespacedRow);
    return typeof value == "number" ? value : value != null ? Number(value) : 0;
  }, valueExtractorWithDate = ([, namespacedRow]) => {
    let value = compiledExpr(namespacedRow);
    return typeof value == "number" || value instanceof Date ? value : value != null ? Number(value) : 0;
  }, rawValueExtractor = ([, namespacedRow]) => compiledExpr(namespacedRow);
  switch (aggExpr.name.toLowerCase()) {
    case "sum":
      return sum(valueExtractor);
    case "count":
      return count2(rawValueExtractor);
    case "avg":
      return avg(valueExtractor);
    case "min":
      return min(valueExtractorWithDate);
    case "max":
      return max(valueExtractorWithDate);
    default:
      throw new UnsupportedAggregateFunctionError(aggExpr.name);
  }
}
function replaceAggregatesByRefs(havingExpr, selectClause, resultAlias = "result") {
  switch (havingExpr.type) {
    case "agg": {
      let aggExpr = havingExpr;
      for (let [alias, selectExpr] of Object.entries(selectClause))
        if (selectExpr.type === "agg" && aggregatesEqual(aggExpr, selectExpr))
          return new PropRef([resultAlias, alias]);
      throw new AggregateFunctionNotInSelectError(aggExpr.name);
    }
    case "func": {
      let funcExpr = havingExpr, transformedArgs = funcExpr.args.map(
        (arg) => replaceAggregatesByRefs(arg, selectClause)
      );
      return new Func(funcExpr.name, transformedArgs);
    }
    case "ref":
      return havingExpr;
    case "val":
      return havingExpr;
    default:
      throw new UnknownHavingExpressionTypeError(havingExpr.type);
  }
}
function aggregatesEqual(agg1, agg2) {
  return agg1.name === agg2.name && agg1.args.length === agg2.args.length && agg1.args.every((arg, i) => expressionsEqual(arg, agg2.args[i]));
}

// packages/db/dist/esm/query/compiler/order-by.js
import { orderByWithFractionalIndex } from "@tanstack/db-ivm";
function processOrderBy(rawQuery, pipeline, orderByClause, selectClause, collection, optimizableOrderByCollections, setWindowFn, limit, offset) {
  let compiledOrderBy = orderByClause.map((clause) => {
    let clauseWithoutAggregates = replaceAggregatesByRefs(
      clause.expression,
      selectClause,
      "__select_results"
    );
    return {
      compiledExpression: compileExpression(clauseWithoutAggregates),
      compareOptions: clause.compareOptions
    };
  }), valueExtractor = (row) => {
    let orderByContext = row;
    return orderByClause.length > 1 ? compiledOrderBy.map(
      (compiled) => compiled.compiledExpression(orderByContext)
    ) : orderByClause.length === 1 ? compiledOrderBy[0].compiledExpression(orderByContext) : null;
  }, compare = (a, b) => {
    if (orderByClause.length > 1) {
      let arrayA = a, arrayB = b;
      for (let i = 0; i < orderByClause.length; i++) {
        let clause = orderByClause[i], result = makeComparator(clause.compareOptions)(arrayA[i], arrayB[i]);
        if (result !== 0)
          return result;
      }
      return arrayA.length - arrayB.length;
    }
    if (orderByClause.length === 1) {
      let clause = orderByClause[0];
      return makeComparator(clause.compareOptions)(a, b);
    }
    return defaultComparator(a, b);
  }, setSizeCallback, orderByOptimizationInfo;
  if (limit && orderByClause.length === 1) {
    let clause = orderByClause[0], orderByExpression = clause.expression;
    if (orderByExpression.type === "ref") {
      let followRefResult = followRef(
        rawQuery,
        orderByExpression,
        collection
      ), followRefCollection = followRefResult.collection, fieldName = followRefResult.path[0];
      fieldName && ensureIndexForField(
        fieldName,
        followRefResult.path,
        followRefCollection,
        clause.compareOptions,
        compare
      );
      let valueExtractorForRawRow = compileExpression(
        new PropRef(followRefResult.path),
        !0
      ), comparator = (a, b) => {
        let extractedA = a && valueExtractorForRawRow(a), extractedB = b && valueExtractorForRawRow(b);
        return compare(extractedA, extractedB);
      }, index = findIndexForField(
        followRefCollection.indexes,
        followRefResult.path,
        clause.compareOptions
      );
      index && index.supports("gt") && (orderByOptimizationInfo = {
        alias: orderByExpression.path.length > 1 ? String(orderByExpression.path[0]) : rawQuery.from.alias,
        offset: offset ?? 0,
        limit,
        comparator,
        valueExtractorForRawRow,
        index,
        orderBy: orderByClause
      }, optimizableOrderByCollections[followRefCollection.id] = orderByOptimizationInfo, setSizeCallback = (getSize) => {
        optimizableOrderByCollections[followRefCollection.id] = {
          ...optimizableOrderByCollections[followRefCollection.id],
          dataNeeded: () => {
            let size = getSize();
            return Math.max(0, orderByOptimizationInfo.limit - size);
          }
        };
      });
    }
  }
  return pipeline.pipe(
    orderByWithFractionalIndex(valueExtractor, {
      limit,
      offset,
      comparator: compare,
      setSizeCallback,
      setWindowFn: (windowFn) => {
        setWindowFn(
          // We wrap the move function such that we update the orderByOptimizationInfo
          // because that is used by the `dataNeeded` callback to determine if we need to load more data
          (options) => {
            windowFn(options), orderByOptimizationInfo && (orderByOptimizationInfo.offset = options.offset ?? orderByOptimizationInfo.offset, orderByOptimizationInfo.limit = options.limit ?? orderByOptimizationInfo.limit);
          }
        );
      }
    })
    // orderByWithFractionalIndex returns [key, [value, index]] - we keep this format
  );
}

// packages/db/dist/esm/query/compiler/select.js
import { map as map3 } from "@tanstack/db-ivm";
function unwrapVal(input) {
  return input instanceof Value ? input.value : input;
}
function processMerge(op, namespacedRow, selectResults) {
  let value = op.source(namespacedRow);
  if (value && typeof value == "object") {
    let cursor = selectResults, path = op.targetPath;
    if (path.length === 0)
      for (let [k, v] of Object.entries(value))
        selectResults[k] = unwrapVal(v);
    else
      for (let i = 0; i < path.length; i++) {
        let seg = path[i];
        if (i === path.length - 1) {
          let dest = cursor[seg] ??= {};
          if (typeof dest == "object")
            for (let [k, v] of Object.entries(value))
              dest[k] = unwrapVal(v);
        } else {
          let next = cursor[seg];
          (next == null || typeof next != "object") && (cursor[seg] = {}), cursor = cursor[seg];
        }
      }
  }
}
function processNonMergeOp(op, namespacedRow, selectResults) {
  let path = op.alias.split(".");
  if (path.length === 1)
    selectResults[op.alias] = op.compiled(namespacedRow);
  else {
    let cursor = selectResults;
    for (let i = 0; i < path.length - 1; i++) {
      let seg = path[i], next = cursor[seg];
      (next == null || typeof next != "object") && (cursor[seg] = {}), cursor = cursor[seg];
    }
    cursor[path[path.length - 1]] = unwrapVal(op.compiled(namespacedRow));
  }
}
function processRow([key, namespacedRow], ops) {
  let selectResults = {};
  for (let op of ops)
    op.kind === "merge" ? processMerge(op, namespacedRow, selectResults) : processNonMergeOp(op, namespacedRow, selectResults);
  return [
    key,
    {
      ...namespacedRow,
      __select_results: selectResults
    }
  ];
}
function processSelect(pipeline, select, _allInputs) {
  let ops = [];
  return addFromObject([], select, ops), pipeline.pipe(map3((row) => processRow(row, ops)));
}
function isAggregateExpression(expr) {
  return expr.type === "agg";
}
function isNestedSelectObject(obj) {
  return obj && typeof obj == "object" && !isExpressionLike(obj);
}
function addFromObject(prefixPath, obj, ops) {
  for (let [key, value] of Object.entries(obj)) {
    if (key.startsWith("__SPREAD_SENTINEL__")) {
      let rest = key.slice(19), splitIndex = rest.lastIndexOf("__"), pathStr = splitIndex >= 0 ? rest.slice(0, splitIndex) : rest, isRefExpr = value && typeof value == "object" && "type" in value && value.type === "ref";
      if (pathStr.includes(".") || isRefExpr) {
        let targetPath = [...prefixPath], expr = isRefExpr ? value : new PropRef(pathStr.split(".")), compiled = compileExpression(expr);
        ops.push({ kind: "merge", targetPath, source: compiled });
      } else {
        let tableAlias = pathStr, targetPath = [...prefixPath];
        ops.push({
          kind: "merge",
          targetPath,
          source: (row) => row[tableAlias]
        });
      }
      continue;
    }
    let expression = value;
    if (isNestedSelectObject(expression)) {
      addFromObject([...prefixPath, key], expression, ops);
      continue;
    }
    if (isAggregateExpression(expression))
      ops.push({
        kind: "field",
        alias: [...prefixPath, key].join("."),
        compiled: () => null
      });
    else {
      if (expression === void 0 || !isExpressionLike(expression)) {
        ops.push({
          kind: "field",
          alias: [...prefixPath, key].join("."),
          compiled: () => expression
        });
        continue;
      }
      if (expression instanceof Value) {
        let val = expression.value;
        ops.push({
          kind: "field",
          alias: [...prefixPath, key].join("."),
          compiled: () => val
        });
      } else
        ops.push({
          kind: "field",
          alias: [...prefixPath, key].join("."),
          compiled: compileExpression(expression)
        });
    }
  }
}

// packages/db/dist/esm/query/compiler/index.js
function compileQuery(rawQuery, inputs, collections, subscriptions, callbacks, lazySources, optimizableOrderByCollections, setWindowFn, cache = /* @__PURE__ */ new WeakMap(), queryMapping = /* @__PURE__ */ new WeakMap()) {
  let cachedResult = cache.get(rawQuery);
  if (cachedResult)
    return cachedResult;
  let { optimizedQuery: query, sourceWhereClauses } = optimizeQuery(rawQuery);
  queryMapping.set(query, rawQuery), mapNestedQueries(query, rawQuery, queryMapping);
  let allInputs = { ...inputs }, aliasToCollectionId = {}, aliasRemapping = {}, sources = {}, {
    alias: mainSource,
    input: mainInput,
    collectionId: mainCollectionId
  } = processFrom(
    query.from,
    allInputs,
    collections,
    subscriptions,
    callbacks,
    lazySources,
    optimizableOrderByCollections,
    setWindowFn,
    cache,
    queryMapping,
    aliasToCollectionId,
    aliasRemapping
  );
  sources[mainSource] = mainInput;
  let pipeline = mainInput.pipe(
    map4(([key, row]) => [key, { [mainSource]: row }])
  );
  if (query.join && query.join.length > 0 && (pipeline = processJoins(
    pipeline,
    query.join,
    sources,
    mainCollectionId,
    mainSource,
    allInputs,
    cache,
    queryMapping,
    collections,
    subscriptions,
    callbacks,
    lazySources,
    optimizableOrderByCollections,
    setWindowFn,
    rawQuery,
    compileQuery,
    aliasToCollectionId,
    aliasRemapping
  )), query.where && query.where.length > 0)
    for (let where of query.where) {
      let whereExpression = getWhereExpression(where), compiledWhere = compileExpression(whereExpression);
      pipeline = pipeline.pipe(
        filter3(([_key, namespacedRow]) => compiledWhere(namespacedRow))
      );
    }
  if (query.fnWhere && query.fnWhere.length > 0)
    for (let fnWhere of query.fnWhere)
      pipeline = pipeline.pipe(
        filter3(([_key, namespacedRow]) => fnWhere(namespacedRow))
      );
  if (query.distinct && !query.fnSelect && !query.select)
    throw new DistinctRequiresSelectError();
  if (query.fnSelect ? pipeline = pipeline.pipe(
    map4(([key, namespacedRow]) => {
      let selectResults = query.fnSelect(namespacedRow);
      return [
        key,
        {
          ...namespacedRow,
          __select_results: selectResults
        }
      ];
    })
  ) : query.select ? pipeline = processSelect(pipeline, query.select) : pipeline = pipeline.pipe(
    map4(([key, namespacedRow]) => {
      let selectResults = !query.join && !query.groupBy ? namespacedRow[mainSource] : namespacedRow;
      return [
        key,
        {
          ...namespacedRow,
          __select_results: selectResults
        }
      ];
    })
  ), query.groupBy && query.groupBy.length > 0 ? pipeline = processGroupBy(
    pipeline,
    query.groupBy,
    query.having,
    query.select,
    query.fnHaving
  ) : query.select && Object.values(query.select).some(
    (expr) => expr.type === "agg"
  ) && (pipeline = processGroupBy(
    pipeline,
    [],
    // Empty group by means single group
    query.having,
    query.select,
    query.fnHaving
  )), query.having && (!query.groupBy || query.groupBy.length === 0) && !(query.select ? Object.values(query.select).some((expr) => expr.type === "agg") : !1))
    throw new HavingRequiresGroupByError();
  if (query.fnHaving && query.fnHaving.length > 0 && (!query.groupBy || query.groupBy.length === 0))
    for (let fnHaving of query.fnHaving)
      pipeline = pipeline.pipe(
        filter3(([_key, namespacedRow]) => fnHaving(namespacedRow))
      );
  if (query.distinct && (pipeline = pipeline.pipe(distinct(([_key, row]) => row.__select_results))), query.orderBy && query.orderBy.length > 0) {
    let result2 = processOrderBy(
      rawQuery,
      pipeline,
      query.orderBy,
      query.select || {},
      collections[mainCollectionId],
      optimizableOrderByCollections,
      setWindowFn,
      query.limit,
      query.offset
    ).pipe(
      map4(([key, [row, orderByIndex]]) => {
        let raw = row.__select_results, finalResults = unwrapValue(raw);
        return [key, [finalResults, orderByIndex]];
      })
    ), compilationResult2 = {
      collectionId: mainCollectionId,
      pipeline: result2,
      sourceWhereClauses,
      aliasToCollectionId,
      aliasRemapping
    };
    return cache.set(rawQuery, compilationResult2), compilationResult2;
  } else if (query.limit !== void 0 || query.offset !== void 0)
    throw new LimitOffsetRequireOrderByError();
  let result = pipeline.pipe(
    map4(([key, row]) => {
      let raw = row.__select_results, finalResults = unwrapValue(raw);
      return [key, [finalResults, void 0]];
    })
  ), compilationResult = {
    collectionId: mainCollectionId,
    pipeline: result,
    sourceWhereClauses,
    aliasToCollectionId,
    aliasRemapping
  };
  return cache.set(rawQuery, compilationResult), compilationResult;
}
function processFrom(from, allInputs, collections, subscriptions, callbacks, lazySources, optimizableOrderByCollections, setWindowFn, cache, queryMapping, aliasToCollectionId, aliasRemapping) {
  switch (from.type) {
    case "collectionRef": {
      let input = allInputs[from.alias];
      if (!input)
        throw new CollectionInputNotFoundError(
          from.alias,
          from.collection.id,
          Object.keys(allInputs)
        );
      return aliasToCollectionId[from.alias] = from.collection.id, { alias: from.alias, input, collectionId: from.collection.id };
    }
    case "queryRef": {
      let originalQuery = queryMapping.get(from.query) || from.query, subQueryResult = compileQuery(
        originalQuery,
        allInputs,
        collections,
        subscriptions,
        callbacks,
        lazySources,
        optimizableOrderByCollections,
        setWindowFn,
        cache,
        queryMapping
      );
      Object.assign(aliasToCollectionId, subQueryResult.aliasToCollectionId), Object.assign(aliasRemapping, subQueryResult.aliasRemapping);
      let innerAlias = Object.keys(subQueryResult.aliasToCollectionId).find(
        (alias) => subQueryResult.aliasToCollectionId[alias] === subQueryResult.collectionId
      );
      innerAlias && innerAlias !== from.alias && (aliasRemapping[from.alias] = innerAlias);
      let extractedInput = subQueryResult.pipeline.pipe(
        map4((data) => {
          let [key, [value, _orderByIndex]] = data, unwrapped = unwrapValue(value);
          return [key, unwrapped];
        })
      );
      return {
        alias: from.alias,
        input: extractedInput,
        collectionId: subQueryResult.collectionId
      };
    }
    default:
      throw new UnsupportedFromTypeError(from.type);
  }
}
function isValue(raw) {
  return raw instanceof Value || raw && typeof raw == "object" && "type" in raw && raw.type === "val";
}
function unwrapValue(value) {
  return isValue(value) ? value.value : value;
}
function mapNestedQueries(optimizedQuery, originalQuery, queryMapping) {
  if (optimizedQuery.from.type === "queryRef" && originalQuery.from.type === "queryRef" && (queryMapping.set(optimizedQuery.from.query, originalQuery.from.query), mapNestedQueries(
    optimizedQuery.from.query,
    originalQuery.from.query,
    queryMapping
  )), optimizedQuery.join && originalQuery.join)
    for (let i = 0; i < optimizedQuery.join.length && i < originalQuery.join.length; i++) {
      let optimizedJoin = optimizedQuery.join[i], originalJoin = originalQuery.join[i];
      optimizedJoin.from.type === "queryRef" && originalJoin.from.type === "queryRef" && (queryMapping.set(optimizedJoin.from.query, originalJoin.from.query), mapNestedQueries(
        optimizedJoin.from.query,
        originalJoin.from.query,
        queryMapping
      ));
    }
}

// packages/db/dist/esm/query/live/collection-config-builder.js
import { D2, output } from "@tanstack/db-ivm";

// packages/db/dist/esm/query/live/collection-subscriber.js
import { MultiSet } from "@tanstack/db-ivm";
var loadMoreCallbackSymbol = Symbol.for(
  "@tanstack/db.collection-config-builder"
), CollectionSubscriber = class {
  constructor(alias, collectionId, collection, collectionConfigBuilder) {
    this.alias = alias, this.collectionId = collectionId, this.collection = collection, this.collectionConfigBuilder = collectionConfigBuilder, this.biggest = void 0, this.subscriptionLoadingPromises = /* @__PURE__ */ new Map();
  }
  subscribe() {
    let whereClause = this.getWhereClauseForAlias();
    if (whereClause) {
      let whereExpression = convertToBasicExpression(whereClause, this.alias);
      if (whereExpression)
        return this.subscribeToChanges(whereExpression);
      throw new WhereClauseConversionError(this.collectionId, this.alias);
    }
    return this.subscribeToChanges();
  }
  subscribeToChanges(whereExpression) {
    let subscription, orderByInfo = this.getOrderByInfo();
    if (orderByInfo)
      subscription = this.subscribeToOrderedChanges(
        whereExpression,
        orderByInfo
      );
    else {
      let includeInitialState = !this.collectionConfigBuilder.isLazyAlias(
        this.alias
      );
      subscription = this.subscribeToMatchingChanges(
        whereExpression,
        includeInitialState
      );
    }
    let statusUnsubscribe = subscription.on("status:change", (event) => {
      if (event.status === "loadingSubset") {
        if (!this.subscriptionLoadingPromises.has(subscription)) {
          let resolve, promise = new Promise((res) => {
            resolve = res;
          });
          this.subscriptionLoadingPromises.set(subscription, {
            resolve
          }), this.collectionConfigBuilder.liveQueryCollection._sync.trackLoadPromise(
            promise
          );
        }
      } else {
        let deferred = this.subscriptionLoadingPromises.get(subscription);
        deferred && (this.subscriptionLoadingPromises.delete(subscription), deferred.resolve());
      }
    }), unsubscribe = () => {
      let deferred = this.subscriptionLoadingPromises.get(subscription);
      deferred && (this.subscriptionLoadingPromises.delete(subscription), deferred.resolve()), statusUnsubscribe(), subscription.unsubscribe();
    };
    return this.collectionConfigBuilder.currentSyncState.unsubscribeCallbacks.add(
      unsubscribe
    ), subscription;
  }
  sendChangesToPipeline(changes, callback) {
    let input = this.collectionConfigBuilder.currentSyncState.inputs[this.alias], dataLoader = sendChangesToInput(
      input,
      changes,
      this.collection.config.getKey
    ) > 0 ? callback : void 0;
    this.collectionConfigBuilder.scheduleGraphRun(dataLoader, {
      alias: this.alias
    });
  }
  subscribeToMatchingChanges(whereExpression, includeInitialState = !1) {
    let sendChanges = (changes) => {
      this.sendChangesToPipeline(changes);
    };
    return this.collection.subscribeChanges(sendChanges, {
      includeInitialState,
      whereExpression
    });
  }
  subscribeToOrderedChanges(whereExpression, orderByInfo) {
    let { orderBy, offset, limit, comparator, dataNeeded, index } = orderByInfo, sendChangesInRange = (changes) => {
      let splittedChanges = splitUpdates(changes), filteredChanges = splittedChanges;
      dataNeeded && dataNeeded() === 0 && (filteredChanges = filterChangesSmallerOrEqualToMax(
        splittedChanges,
        comparator,
        this.biggest
      )), this.sendChangesToPipelineWithTracking(filteredChanges, subscription);
    }, subscription = this.collection.subscribeChanges(sendChangesInRange, {
      whereExpression
    });
    subscription.setOrderByIndex(index);
    let normalizedOrderBy = convertOrderByToBasicExpression(
      orderBy,
      this.alias
    );
    return subscription.requestLimitedSnapshot({
      limit: offset + limit,
      orderBy: normalizedOrderBy
    }), subscription;
  }
  // This function is called by maybeRunGraph
  // after each iteration of the query pipeline
  // to ensure that the orderBy operator has enough data to work with
  loadMoreIfNeeded(subscription) {
    let orderByInfo = this.getOrderByInfo();
    if (!orderByInfo)
      return !0;
    let { dataNeeded } = orderByInfo;
    if (!dataNeeded)
      throw new Error(
        `Missing dataNeeded callback for collection ${this.collectionId}`
      );
    let n = dataNeeded();
    return n > 0 && this.loadNextItems(n, subscription), !0;
  }
  sendChangesToPipelineWithTracking(changes, subscription) {
    let orderByInfo = this.getOrderByInfo();
    if (!orderByInfo) {
      this.sendChangesToPipeline(changes);
      return;
    }
    let trackedChanges = this.trackSentValues(changes, orderByInfo.comparator), subscriptionWithLoader = subscription;
    subscriptionWithLoader[loadMoreCallbackSymbol] ??= this.loadMoreIfNeeded.bind(this, subscription), this.sendChangesToPipeline(
      trackedChanges,
      subscriptionWithLoader[loadMoreCallbackSymbol]
    );
  }
  // Loads the next `n` items from the collection
  // starting from the biggest item it has sent
  loadNextItems(n, subscription) {
    let orderByInfo = this.getOrderByInfo();
    if (!orderByInfo)
      return;
    let { orderBy, valueExtractorForRawRow } = orderByInfo, biggestSentRow = this.biggest, biggestSentValue = biggestSentRow && valueExtractorForRawRow(biggestSentRow), normalizedOrderBy = convertOrderByToBasicExpression(
      orderBy,
      this.alias
    );
    subscription.requestLimitedSnapshot({
      orderBy: normalizedOrderBy,
      limit: n,
      minValue: biggestSentValue
    });
  }
  getWhereClauseForAlias() {
    let sourceWhereClausesCache = this.collectionConfigBuilder.sourceWhereClausesCache;
    if (sourceWhereClausesCache)
      return sourceWhereClausesCache.get(this.alias);
  }
  getOrderByInfo() {
    let info = this.collectionConfigBuilder.optimizableOrderByCollections[this.collectionId];
    if (info && info.alias === this.alias)
      return info;
  }
  *trackSentValues(changes, comparator) {
    for (let change of changes)
      this.biggest ? comparator(this.biggest, change.value) < 0 && (this.biggest = change.value) : this.biggest = change.value, yield change;
  }
};
function sendChangesToInput(input, changes, getKey) {
  let multiSetArray = [];
  for (let change of changes) {
    let key = getKey(change.value);
    change.type === "insert" ? multiSetArray.push([[key, change.value], 1]) : change.type === "update" ? (multiSetArray.push([[key, change.previousValue], -1]), multiSetArray.push([[key, change.value], 1])) : multiSetArray.push([[key, change.value], -1]);
  }
  return multiSetArray.length !== 0 && input.sendData(new MultiSet(multiSetArray)), multiSetArray.length;
}
function* splitUpdates(changes) {
  for (let change of changes)
    change.type === "update" ? (yield { type: "delete", key: change.key, value: change.previousValue }, yield { type: "insert", key: change.key, value: change.value }) : yield change;
}
function* filterChanges(changes, f) {
  for (let change of changes)
    f(change) && (yield change);
}
function* filterChangesSmallerOrEqualToMax(changes, comparator, maxValue) {
  yield* filterChanges(changes, (change) => !maxValue || comparator(change.value, maxValue) <= 0);
}

// packages/db/dist/esm/query/live/collection-registry.js
var collectionBuilderRegistry = /* @__PURE__ */ new WeakMap();
function getBuilderFromConfig(config) {
  return config.utils?.getBuilder?.();
}
function registerCollectionBuilder(collection, builder) {
  collectionBuilderRegistry.set(collection, builder);
}
function getCollectionBuilder(collection) {
  return collectionBuilderRegistry.get(collection);
}

// packages/db/dist/esm/query/live/collection-config-builder.js
var liveQueryCollectionCounter = 0, CollectionConfigBuilder = class {
  constructor(config) {
    this.config = config, this.compiledAliasToCollectionId = {}, this.resultKeys = /* @__PURE__ */ new WeakMap(), this.orderByIndices = /* @__PURE__ */ new WeakMap(), this.isGraphRunning = !1, this.runCount = 0, this.isInErrorState = !1, this.aliasDependencies = {}, this.builderDependencies = /* @__PURE__ */ new Set(), this.pendingGraphRuns = /* @__PURE__ */ new Map(), this.subscriptions = {}, this.lazySourcesCallbacks = {}, this.lazySources = /* @__PURE__ */ new Set(), this.optimizableOrderByCollections = {}, this.id = config.id || `live-query-${++liveQueryCollectionCounter}`, this.query = buildQueryFromConfig(config), this.collections = extractCollectionsFromQuery(this.query);
    let collectionAliasesById = extractCollectionAliases(this.query);
    this.collectionByAlias = {};
    for (let [collectionId, aliases] of collectionAliasesById.entries()) {
      let collection = this.collections[collectionId];
      if (collection)
        for (let alias of aliases)
          this.collectionByAlias[alias] = collection;
    }
    this.query.orderBy && this.query.orderBy.length > 0 && (this.compare = createOrderByComparator(this.orderByIndices)), this.compileBasePipeline();
  }
  getConfig() {
    return {
      id: this.id,
      getKey: this.config.getKey || ((item) => this.resultKeys.get(item)),
      sync: this.getSyncConfig(),
      compare: this.compare,
      gcTime: this.config.gcTime || 5e3,
      // 5 seconds by default for live queries
      schema: this.config.schema,
      onInsert: this.config.onInsert,
      onUpdate: this.config.onUpdate,
      onDelete: this.config.onDelete,
      startSync: this.config.startSync,
      singleResult: this.query.singleResult,
      utils: {
        getRunCount: this.getRunCount.bind(this),
        getBuilder: () => this,
        setWindow: this.setWindow.bind(this),
        getWindow: this.getWindow.bind(this)
      }
    };
  }
  setWindow(options) {
    if (!this.windowFn)
      throw new SetWindowRequiresOrderByError();
    return this.currentWindow = options, this.windowFn(options), this.maybeRunGraphFn?.(), this.liveQueryCollection?.isLoadingSubset ? new Promise((resolve) => {
      let unsubscribe = this.liveQueryCollection.on(
        "loadingSubset:change",
        (event) => {
          event.isLoadingSubset || (unsubscribe(), resolve());
        }
      );
    }) : !0;
  }
  getWindow() {
    if (!(!this.windowFn || !this.currentWindow))
      return {
        offset: this.currentWindow.offset ?? 0,
        limit: this.currentWindow.limit ?? 0
      };
  }
  /**
   * Resolves a collection alias to its collection ID.
   *
   * Uses a two-tier lookup strategy:
   * 1. First checks compiled aliases (includes subquery inner aliases)
   * 2. Falls back to declared aliases from the query's from/join clauses
   *
   * @param alias - The alias to resolve (e.g., "employee", "manager")
   * @returns The collection ID that the alias references
   * @throws {Error} If the alias is not found in either lookup
   */
  getCollectionIdForAlias(alias) {
    let compiled = this.compiledAliasToCollectionId[alias];
    if (compiled)
      return compiled;
    let collection = this.collectionByAlias[alias];
    if (collection)
      return collection.id;
    throw new Error(`Unknown source alias "${alias}"`);
  }
  isLazyAlias(alias) {
    return this.lazySources.has(alias);
  }
  // The callback function is called after the graph has run.
  // This gives the callback a chance to load more data if needed,
  // that's used to optimize orderBy operators that set a limit,
  // in order to load some more data if we still don't have enough rows after the pipeline has run.
  // That can happen because even though we load N rows, the pipeline might filter some of these rows out
  // causing the orderBy operator to receive less than N rows or even no rows at all.
  // So this callback would notice that it doesn't have enough rows and load some more.
  // The callback returns a boolean, when it's true it's done loading data and we can mark the collection as ready.
  maybeRunGraph(callback) {
    if (!this.isGraphRunning) {
      if (!this.currentSyncConfig || !this.currentSyncState)
        throw new Error(
          "maybeRunGraph called without active sync session. This should not happen."
        );
      this.isGraphRunning = !0;
      try {
        let { begin, commit } = this.currentSyncConfig, syncState = this.currentSyncState;
        if (this.isInErrorState)
          return;
        if (syncState.subscribedToAllCollections) {
          for (; syncState.graph.pendingWork(); )
            syncState.graph.run(), callback?.();
          syncState.messagesCount === 0 && (begin(), commit(), this.updateLiveQueryStatus(this.currentSyncConfig));
        }
      } finally {
        this.isGraphRunning = !1;
      }
    }
  }
  /**
   * Schedules a graph run with the transaction-scoped scheduler.
   * Ensures each builder runs at most once per transaction, with automatic dependency tracking
   * to run parent queries before child queries. Outside a transaction, runs immediately.
   *
   * Multiple calls during a transaction are coalesced into a single execution.
   * Dependencies are auto-discovered from subscribed live queries, or can be overridden.
   * Load callbacks are combined when entries merge.
   *
   * Uses the current sync session's config and syncState from instance properties.
   *
   * @param callback - Optional callback to load more data if needed (returns true when done)
   * @param options - Optional scheduling configuration
   * @param options.contextId - Transaction ID to group work; defaults to active transaction
   * @param options.jobId - Unique identifier for this job; defaults to this builder instance
   * @param options.alias - Source alias that triggered this schedule; adds alias-specific dependencies
   * @param options.dependencies - Explicit dependency list; overrides auto-discovered dependencies
   */
  scheduleGraphRun(callback, options) {
    let contextId = options?.contextId ?? getActiveTransaction()?.id, jobId = options?.jobId ?? this, dependentBuilders = (() => {
      if (options?.dependencies)
        return options.dependencies;
      let deps = new Set(this.builderDependencies);
      if (options?.alias) {
        let aliasDeps = this.aliasDependencies[options.alias];
        if (aliasDeps)
          for (let dep of aliasDeps)
            deps.add(dep);
      }
      return deps.delete(this), Array.from(deps);
    })();
    if (!this.currentSyncConfig || !this.currentSyncState)
      throw new Error(
        "scheduleGraphRun called without active sync session. This should not happen."
      );
    let pending = contextId ? this.pendingGraphRuns.get(contextId) : void 0;
    pending || (pending = {
      loadCallbacks: /* @__PURE__ */ new Set()
    }, contextId && this.pendingGraphRuns.set(contextId, pending)), callback && pending.loadCallbacks.add(callback);
    let pendingToPass = contextId ? void 0 : pending;
    transactionScopedScheduler.schedule({
      contextId,
      jobId,
      dependencies: dependentBuilders,
      run: () => this.executeGraphRun(contextId, pendingToPass)
    });
  }
  /**
   * Clears pending graph run state for a specific context.
   * Called when the scheduler clears a context (e.g., transaction rollback/abort).
   */
  clearPendingGraphRun(contextId) {
    this.pendingGraphRuns.delete(contextId);
  }
  /**
   * Executes a pending graph run. Called by the scheduler when dependencies are satisfied.
   * Clears the pending state BEFORE execution so that any re-schedules during the run
   * create fresh state and don't interfere with the current execution.
   * Uses instance sync state - if sync has ended, gracefully returns without executing.
   *
   * @param contextId - Optional context ID to look up pending state
   * @param pendingParam - For immediate execution (no context), pending state is passed directly
   */
  executeGraphRun(contextId, pendingParam) {
    let pending = pendingParam ?? (contextId ? this.pendingGraphRuns.get(contextId) : void 0);
    if (contextId && this.pendingGraphRuns.delete(contextId), !pending || !this.currentSyncConfig || !this.currentSyncState)
      return;
    this.incrementRunCount();
    let combinedLoader = () => {
      let allDone = !0, firstError;
      if (pending.loadCallbacks.forEach((loader) => {
        try {
          allDone = loader() && allDone;
        } catch (error) {
          allDone = !1, firstError ??= error;
        }
      }), firstError)
        throw firstError;
      return allDone;
    };
    this.maybeRunGraph(combinedLoader);
  }
  getSyncConfig() {
    return {
      rowUpdateMode: "full",
      sync: this.syncFn.bind(this)
    };
  }
  incrementRunCount() {
    this.runCount++;
  }
  getRunCount() {
    return this.runCount;
  }
  syncFn(config) {
    this.liveQueryCollection = config.collection, this.currentSyncConfig = config;
    let syncState = {
      messagesCount: 0,
      subscribedToAllCollections: !1,
      unsubscribeCallbacks: /* @__PURE__ */ new Set()
    }, fullSyncState = this.extendPipelineWithChangeProcessing(
      config,
      syncState
    );
    this.currentSyncState = fullSyncState, this.unsubscribeFromSchedulerClears = transactionScopedScheduler.onClear(
      (contextId) => {
        this.clearPendingGraphRun(contextId);
      }
    );
    let loadSubsetDataCallbacks = this.subscribeToAllCollections(
      config,
      fullSyncState
    );
    return this.maybeRunGraphFn = () => this.scheduleGraphRun(loadSubsetDataCallbacks), this.scheduleGraphRun(loadSubsetDataCallbacks), () => {
      syncState.unsubscribeCallbacks.forEach((unsubscribe) => unsubscribe()), this.currentSyncConfig = void 0, this.currentSyncState = void 0, this.pendingGraphRuns.clear(), this.graphCache = void 0, this.inputsCache = void 0, this.pipelineCache = void 0, this.sourceWhereClausesCache = void 0, this.lazySources.clear(), this.optimizableOrderByCollections = {}, this.lazySourcesCallbacks = {}, Object.keys(this.subscriptions).forEach(
        (key) => delete this.subscriptions[key]
      ), this.compiledAliasToCollectionId = {}, this.unsubscribeFromSchedulerClears?.(), this.unsubscribeFromSchedulerClears = void 0;
    };
  }
  /**
   * Compiles the query pipeline with all declared aliases.
   */
  compileBasePipeline() {
    this.graphCache = new D2(), this.inputsCache = Object.fromEntries(
      Object.keys(this.collectionByAlias).map((alias) => [
        alias,
        this.graphCache.newInput()
      ])
    );
    let compilation = compileQuery(
      this.query,
      this.inputsCache,
      this.collections,
      this.subscriptions,
      this.lazySourcesCallbacks,
      this.lazySources,
      this.optimizableOrderByCollections,
      (windowFn) => {
        this.windowFn = windowFn;
      }
    );
    this.pipelineCache = compilation.pipeline, this.sourceWhereClausesCache = compilation.sourceWhereClauses, this.compiledAliasToCollectionId = compilation.aliasToCollectionId;
    let missingAliases = Object.keys(this.compiledAliasToCollectionId).filter(
      (alias) => !Object.hasOwn(this.inputsCache, alias)
    );
    if (missingAliases.length > 0)
      throw new MissingAliasInputsError(missingAliases);
  }
  maybeCompileBasePipeline() {
    return (!this.graphCache || !this.inputsCache || !this.pipelineCache) && this.compileBasePipeline(), {
      graph: this.graphCache,
      inputs: this.inputsCache,
      pipeline: this.pipelineCache
    };
  }
  extendPipelineWithChangeProcessing(config, syncState) {
    let { begin, commit } = config, { graph, inputs, pipeline } = this.maybeCompileBasePipeline();
    return pipeline.pipe(
      output((data) => {
        let messages = data.getInner();
        syncState.messagesCount += messages.length, begin(), messages.reduce(
          accumulateChanges,
          /* @__PURE__ */ new Map()
        ).forEach(this.applyChanges.bind(this, config)), commit();
      })
    ), graph.finalize(), syncState.graph = graph, syncState.inputs = inputs, syncState.pipeline = pipeline, syncState;
  }
  applyChanges(config, changes, key) {
    let { write, collection } = config, { deletes, inserts, value, orderByIndex } = changes;
    if (this.resultKeys.set(value, key), orderByIndex !== void 0 && this.orderByIndices.set(value, orderByIndex), inserts && deletes === 0)
      write({
        value,
        type: "insert"
      });
    else if (
      // Insert & update(s) (updates are a delete & insert)
      inserts > deletes || // Just update(s) but the item is already in the collection (so
      // was inserted previously).
      inserts === deletes && collection.has(collection.getKeyFromItem(value))
    )
      write({
        value,
        type: "update"
      });
    else if (deletes > 0)
      write({
        value,
        type: "delete"
      });
    else
      throw new Error(
        `Could not apply changes: ${JSON.stringify(changes)}. This should never happen.`
      );
  }
  /**
   * Handle status changes from source collections
   */
  handleSourceStatusChange(config, collectionId, event) {
    let { status } = event;
    if (status === "error") {
      this.transitionToError(
        `Source collection '${collectionId}' entered error state`
      );
      return;
    }
    if (status === "cleaned-up") {
      this.transitionToError(
        `Source collection '${collectionId}' was manually cleaned up while live query '${this.id}' depends on it. Live queries prevent automatic GC, so this was likely a manual cleanup() call.`
      );
      return;
    }
    this.updateLiveQueryStatus(config);
  }
  /**
   * Update the live query status based on source collection statuses
   */
  updateLiveQueryStatus(config) {
    let { markReady } = config;
    this.isInErrorState || this.allCollectionsReady() && markReady();
  }
  /**
   * Transition the live query to error state
   */
  transitionToError(message) {
    this.isInErrorState = !0, console.error(`[Live Query Error] ${message}`), this.liveQueryCollection?._lifecycle.setStatus("error");
  }
  allCollectionsReady() {
    return Object.values(this.collections).every(
      (collection) => collection.isReady()
    );
  }
  /**
   * Creates per-alias subscriptions enabling self-join support.
   * Each alias gets its own subscription with independent filters, even for the same collection.
   * Example: `{ employee: col, manager: col }` creates two separate subscriptions.
   */
  subscribeToAllCollections(config, syncState) {
    let compiledAliases = Object.entries(this.compiledAliasToCollectionId);
    if (compiledAliases.length === 0)
      throw new Error(
        `Compiler returned no alias metadata for query '${this.id}'. This should not happen; please report.`
      );
    let loaders = compiledAliases.map(([alias, collectionId]) => {
      let collection = this.collectionByAlias[alias] ?? this.collections[collectionId], dependencyBuilder = getCollectionBuilder(collection);
      dependencyBuilder && dependencyBuilder !== this ? (this.aliasDependencies[alias] = [dependencyBuilder], this.builderDependencies.add(dependencyBuilder)) : this.aliasDependencies[alias] = [];
      let collectionSubscriber = new CollectionSubscriber(
        alias,
        collectionId,
        collection,
        this
      ), statusUnsubscribe = collection.on("status:change", (event) => {
        this.handleSourceStatusChange(config, collectionId, event);
      });
      syncState.unsubscribeCallbacks.add(statusUnsubscribe);
      let subscription = collectionSubscriber.subscribe();
      return this.subscriptions[alias] = subscription, collectionSubscriber.loadMoreIfNeeded.bind(
        collectionSubscriber,
        subscription
      );
    }), loadSubsetDataCallbacks = () => (loaders.map((loader) => loader()), !0);
    return syncState.subscribedToAllCollections = !0, this.updateLiveQueryStatus(config), loadSubsetDataCallbacks;
  }
};
function buildQueryFromConfig(config) {
  return typeof config.query == "function" ? buildQuery(config.query) : getQueryIR(config.query);
}
function createOrderByComparator(orderByIndices) {
  return (val1, val2) => {
    let index1 = orderByIndices.get(val1), index2 = orderByIndices.get(val2);
    return index1 && index2 ? index1 < index2 ? -1 : index1 > index2 ? 1 : 0 : 0;
  };
}
function extractCollectionsFromQuery(query) {
  let collections = {};
  function extractFromSource(source) {
    source.type === "collectionRef" ? collections[source.collection.id] = source.collection : source.type === "queryRef" && extractFromQuery(source.query);
  }
  function extractFromQuery(q) {
    if (q.from && extractFromSource(q.from), q.join && Array.isArray(q.join))
      for (let joinClause of q.join)
        joinClause.from && extractFromSource(joinClause.from);
  }
  return extractFromQuery(query), collections;
}
function extractCollectionAliases(query) {
  let aliasesById = /* @__PURE__ */ new Map();
  function recordAlias(source) {
    if (source)
      if (source.type === "collectionRef") {
        let { id } = source.collection, existing = aliasesById.get(id);
        existing ? existing.add(source.alias) : aliasesById.set(id, /* @__PURE__ */ new Set([source.alias]));
      } else source.type === "queryRef" && traverse(source.query);
  }
  function traverse(q) {
    if (q && (recordAlias(q.from), q.join))
      for (let joinClause of q.join)
        recordAlias(joinClause.from);
  }
  return traverse(query), aliasesById;
}
function accumulateChanges(acc, [[key, tupleData], multiplicity]) {
  let [value, orderByIndex] = tupleData, changes = acc.get(key) || {
    deletes: 0,
    inserts: 0,
    value,
    orderByIndex
  };
  return multiplicity < 0 ? changes.deletes += Math.abs(multiplicity) : multiplicity > 0 && (changes.inserts += multiplicity, changes.value = value, changes.orderByIndex = orderByIndex), acc.set(key, changes), acc;
}

// packages/db/dist/esm/query/live-query-collection.js
function liveQueryCollectionOptions(config) {
  return new CollectionConfigBuilder(config).getConfig();
}
function createLiveQueryCollection(configOrQuery) {
  if (typeof configOrQuery == "function") {
    let options = liveQueryCollectionOptions({
      query: configOrQuery
    });
    return bridgeToCreateCollection(options);
  } else {
    let config = configOrQuery, options = liveQueryCollectionOptions(config);
    return config.utils && (options.utils = { ...options.utils, ...config.utils }), bridgeToCreateCollection(options);
  }
}
function bridgeToCreateCollection(options) {
  let collection = createCollection(options), builder = getBuilderFromConfig(options);
  return builder && registerCollectionBuilder(collection, builder), collection;
}

// test-full.js
console.log(typeof createCollection, typeof Query, typeof localStorageCollectionOptions, typeof createLiveQueryCollection);
