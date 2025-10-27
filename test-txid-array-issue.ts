/**
 * Test to reproduce the txid array issue described by the Discord user
 *
 * Issue: Returning an array of txids causes delete -> insert -> delete flicker
 * Expected: Single txid works fine, array of txids should also work
 */

import { createCollection } from "@tanstack/db"
import { electricCollectionOptions } from "./packages/electric-db-collection/src/electric"

// Simulate the user's code pattern
const deleteContactSF = async (contact: any) => {
  // Simulates calling a server function that returns a txid
  return { txid: 123 }
}

// Pattern 1: Returning array of txids (causes flicker)
const configWithArrayTxid = {
  id: "contacts-array",
  shapeOptions: {
    url: "http://example.com",
    params: { table: "contacts" },
  },
  getKey: (item: any) => item.id,
  onDelete: async ({ transaction }: any) => {
    // User's current pattern - returns array
    const deleted = await Promise.all(
      transaction.mutations.map(async (mutation: any) => {
        const deleted = await deleteContactSF(mutation.original)
        return deleted
      })
    )
    return { txid: deleted.map((d: any) => d.txid) } // Returns { txid: [123] }
  },
}

// Pattern 2: Returning single txid (works fine)
const configWithSingleTxid = {
  id: "contacts-single",
  shapeOptions: {
    url: "http://example.com",
    params: { table: "contacts" },
  },
  getKey: (item: any) => item.id,
  onDelete: async ({ transaction }: any) => {
    // Recommended pattern - returns single txid
    const mutation = transaction.mutations[0]
    const result = await deleteContactSF(mutation.original)
    return { txid: result.txid } // Returns { txid: 123 }
  },
}

/**
 * Analysis:
 *
 * When deleting ONE item:
 * - Pattern 1 returns: { txid: [123] }
 * - Pattern 2 returns: { txid: 123 }
 *
 * In processMatchingStrategy (electric.ts:502-515):
 * - Pattern 1: await Promise.all([awaitTxId(123)])
 * - Pattern 2: await awaitTxId(123)
 *
 * These should be functionally equivalent!
 *
 * HYPOTHESIS: The issue might be that the user is calling deleteContactSF
 * multiple times (once per mutation) even when there's only one mutation.
 * If deleteContactSF has side effects or returns different txids, this could
 * cause unexpected behavior.
 *
 * OR: The user might be returning an array of arrays [[123]] accidentally.
 */

console.log("Test scenarios created")
console.log("Pattern 1 (array):", configWithArrayTxid.onDelete)
console.log("Pattern 2 (single):", configWithSingleTxid.onDelete)
