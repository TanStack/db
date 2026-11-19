/**
 * @internal Pre-5.4 inference barrier. Kept package-local so declarations work
 * with every core SDK version allowed by this package's peer dependency.
 */
// biome-ignore lint/suspicious/noExplicitAny: This is the pre-5.4 deferred-conditional inference barrier.
export type NoInferCompat<T> = [T][T extends any ? 0 : never];
