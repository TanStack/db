// Re-export all operators
// Importing from here will auto-register all evaluators

// Comparison operators
export { eq } from "./eq.js"
export { gt } from "./gt.js"
export { gte } from "./gte.js"
export { lt } from "./lt.js"
export { lte } from "./lte.js"

// Boolean operators
export { and } from "./and.js"
export { or } from "./or.js"
export { not } from "./not.js"

// Array operators
export { inArray } from "./in.js"

// String pattern operators
export { like } from "./like.js"
export { ilike } from "./ilike.js"

// String functions
export { upper } from "./upper.js"
export { lower } from "./lower.js"
export { length } from "./length.js"
export { concat } from "./concat.js"
export { coalesce } from "./coalesce.js"

// Math functions
export { add } from "./add.js"
export { subtract } from "./subtract.js"
export { multiply } from "./multiply.js"
export { divide } from "./divide.js"

// Null checking functions
export { isNull } from "./isNull.js"
export { isUndefined } from "./isUndefined.js"
