import { PropRef, Value } from "../ir.js";
/**
 * Creates a proxy object that records property access paths for a single row
 * Used in collection indexes and where clauses
 */
export function createSingleRowRefProxy() {
    const cache = new Map();
    function createProxy(path) {
        const pathKey = path.join(`.`);
        if (cache.has(pathKey)) {
            return cache.get(pathKey);
        }
        const proxy = new Proxy({}, {
            get(target, prop, receiver) {
                if (prop === `__refProxy`)
                    return true;
                if (prop === `__path`)
                    return path;
                if (prop === `__type`)
                    return undefined; // Type is only for TypeScript inference
                if (typeof prop === `symbol`)
                    return Reflect.get(target, prop, receiver);
                const newPath = [...path, String(prop)];
                return createProxy(newPath);
            },
            has(target, prop) {
                if (prop === `__refProxy` || prop === `__path` || prop === `__type`)
                    return true;
                return Reflect.has(target, prop);
            },
            ownKeys(target) {
                return Reflect.ownKeys(target);
            },
            getOwnPropertyDescriptor(target, prop) {
                if (prop === `__refProxy` || prop === `__path` || prop === `__type`) {
                    return { enumerable: false, configurable: true };
                }
                return Reflect.getOwnPropertyDescriptor(target, prop);
            },
        });
        cache.set(pathKey, proxy);
        return proxy;
    }
    // Return the root proxy that starts with an empty path
    return createProxy([]);
}
/**
 * Creates a proxy object that records property access paths
 * Used in callbacks like where, select, etc. to create type-safe references
 */
export function createRefProxy(aliases) {
    const cache = new Map();
    const spreadSentinels = new Set(); // Track which aliases have been spread
    function createProxy(path) {
        const pathKey = path.join(`.`);
        if (cache.has(pathKey)) {
            return cache.get(pathKey);
        }
        const proxy = new Proxy({}, {
            get(target, prop, receiver) {
                if (prop === `__refProxy`)
                    return true;
                if (prop === `__path`)
                    return path;
                if (prop === `__type`)
                    return undefined; // Type is only for TypeScript inference
                if (typeof prop === `symbol`)
                    return Reflect.get(target, prop, receiver);
                const newPath = [...path, String(prop)];
                return createProxy(newPath);
            },
            has(target, prop) {
                if (prop === `__refProxy` || prop === `__path` || prop === `__type`)
                    return true;
                return Reflect.has(target, prop);
            },
            ownKeys(target) {
                // If this is a table-level proxy (path length 1), mark it as spread
                if (path.length === 1) {
                    const aliasName = path[0];
                    spreadSentinels.add(aliasName);
                }
                return Reflect.ownKeys(target);
            },
            getOwnPropertyDescriptor(target, prop) {
                if (prop === `__refProxy` || prop === `__path` || prop === `__type`) {
                    return { enumerable: false, configurable: true };
                }
                return Reflect.getOwnPropertyDescriptor(target, prop);
            },
        });
        cache.set(pathKey, proxy);
        return proxy;
    }
    // Create the root proxy with all aliases as top-level properties
    const rootProxy = new Proxy({}, {
        get(target, prop, receiver) {
            if (prop === `__refProxy`)
                return true;
            if (prop === `__path`)
                return [];
            if (prop === `__type`)
                return undefined; // Type is only for TypeScript inference
            if (prop === `__spreadSentinels`)
                return spreadSentinels; // Expose spread sentinels
            if (typeof prop === `symbol`)
                return Reflect.get(target, prop, receiver);
            const propStr = String(prop);
            if (aliases.includes(propStr)) {
                return createProxy([propStr]);
            }
            return undefined;
        },
        has(target, prop) {
            if (prop === `__refProxy` ||
                prop === `__path` ||
                prop === `__type` ||
                prop === `__spreadSentinels`)
                return true;
            if (typeof prop === `string` && aliases.includes(prop))
                return true;
            return Reflect.has(target, prop);
        },
        ownKeys(_target) {
            return [...aliases, `__refProxy`, `__path`, `__type`, `__spreadSentinels`];
        },
        getOwnPropertyDescriptor(target, prop) {
            if (prop === `__refProxy` ||
                prop === `__path` ||
                prop === `__type` ||
                prop === `__spreadSentinels`) {
                return { enumerable: false, configurable: true };
            }
            if (typeof prop === `string` && aliases.includes(prop)) {
                return { enumerable: true, configurable: true };
            }
            return undefined;
        },
    });
    return rootProxy;
}
export function toExpression(value) {
    if (isRefProxy(value)) {
        return new PropRef(value.__path);
    }
    // If it's already an Expression (Func, Ref, Value) or Agg, return it directly
    if (value &&
        typeof value === `object` &&
        `type` in value &&
        (value.type === `func` ||
            value.type === `ref` ||
            value.type === `val` ||
            value.type === `agg`)) {
        return value;
    }
    return new Value(value);
}
/**
 * Type guard to check if a value is a RefProxy
 */
export function isRefProxy(value) {
    return value && typeof value === `object` && value.__refProxy === true;
}
/**
 * Helper to create a Value expression from a literal
 */
export function val(value) {
    return new Value(value);
}
