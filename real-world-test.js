// Simulate real-world usage - import from published package
// We'll manually include the query compiler to see db-ivm impact

import { compileQuery } from './packages/db/dist/esm/query/compiler/index.js'
import { D2 } from './packages/db-ivm/dist/esm/d2.js'

console.log(compileQuery, D2)
