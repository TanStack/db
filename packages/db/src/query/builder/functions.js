import { Aggregate, Func, Value } from "../ir";
import { toExpression } from "./ref-proxy.js";
export function eq(left, right) {
    return new Func(`eq`, [toExpression(left), toExpression(right)]);
}
export function gt(left, right) {
    return new Func(`gt`, [toExpression(left), toExpression(right)]);
}
export function gte(left, right) {
    return new Func(`gte`, [toExpression(left), toExpression(right)]);
}
export function lt(left, right) {
    return new Func(`lt`, [toExpression(left), toExpression(right)]);
}
export function lte(left, right) {
    return new Func(`lte`, [toExpression(left), toExpression(right)]);
}
export function and(left, right, ...rest) {
    const allArgs = [left, right, ...rest];
    return new Func(`and`, allArgs.map((arg) => toExpression(arg)));
}
export function or(left, right, ...rest) {
    const allArgs = [left, right, ...rest];
    return new Func(`or`, allArgs.map((arg) => toExpression(arg)));
}
export function not(value) {
    return new Func(`not`, [toExpression(value)]);
}
export function inArray(value, array) {
    return new Func(`in`, [toExpression(value), toExpression(array)]);
}
export function like(left, right) {
    return new Func(`like`, [toExpression(left), toExpression(right)]);
}
export function ilike(left, right) {
    return new Func(`ilike`, [toExpression(left), toExpression(right)]);
}
export function similar(left, right, threshold) {
    const args = [toExpression(left), toExpression(right)];
    if (threshold !== undefined) {
        // Handle number threshold by creating a Value expression
        if (typeof threshold === 'number') {
            args.push(new Value(threshold));
        }
        else {
            args.push(threshold);
        }
    }
    return new Func(`similar`, args);
}
// Functions
export function upper(arg) {
    return new Func(`upper`, [toExpression(arg)]);
}
export function lower(arg) {
    return new Func(`lower`, [toExpression(arg)]);
}
export function length(arg) {
    return new Func(`length`, [toExpression(arg)]);
}
export function concat(...args) {
    return new Func(`concat`, args.map((arg) => toExpression(arg)));
}
export function coalesce(...args) {
    return new Func(`coalesce`, args.map((arg) => toExpression(arg)));
}
export function add(left, right) {
    return new Func(`add`, [toExpression(left), toExpression(right)]);
}
// Aggregates
export function count(arg) {
    return new Aggregate(`count`, [toExpression(arg)]);
}
export function avg(arg) {
    return new Aggregate(`avg`, [toExpression(arg)]);
}
export function sum(arg) {
    return new Aggregate(`sum`, [toExpression(arg)]);
}
export function min(arg) {
    return new Aggregate(`min`, [toExpression(arg)]);
}
export function max(arg) {
    return new Aggregate(`max`, [toExpression(arg)]);
}
