// Re-export all aggregates
// Each aggregate is a function that creates Aggregate IR nodes with embedded configs

export { sum } from './sum.js'
export { count } from './count.js'
export { avg } from './avg.js'
export { min } from './min.js'
export { max } from './max.js'
export { collect } from './collect.js'
export { minStr } from './minStr.js'
export { maxStr } from './maxStr.js'
