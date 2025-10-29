// Test: Import collection WITHOUT query compiler
// This should NOT pull in db-ivm

import { CollectionImpl } from './packages/db/dist/esm/collection/index.js'
import { createTransaction } from './packages/db/dist/esm/transactions.js'

console.log(CollectionImpl, createTransaction)
