// Test what happens when we include db-ivm
import { createCollection } from './packages/db/dist/esm/index.js'

// This will pull in db-ivm as a dependency
console.log(createCollection)
