/**
 * Creates a Deferred object containing a Promise and methods to control it.
 *
 * @returns A Deferred object with promise, resolve, reject, and isPending methods
 */
export function createDeferred() {
    let resolve;
    let reject;
    let isPending = true;
    const promise = new Promise((res, rej) => {
        resolve = (value) => {
            isPending = false;
            res(value);
        };
        reject = (reason) => {
            isPending = false;
            rej(reason);
        };
    });
    return {
        promise,
        resolve,
        reject,
        isPending: () => isPending,
    };
}
