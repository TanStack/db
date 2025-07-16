import { OrderedIndex } from "./ordered-index.js"
import { TrigramIndex } from "./trigram-index.js"

/**
 * Pre-defined index types for common usage patterns
 */
export const IndexTypes = {
  // Synchronous (immediate loading)
  Ordered: OrderedIndex,
  Trigram: TrigramIndex,
  
  // Backward compatibility (deprecated)
  BTree: OrderedIndex,
  
  // Asynchronous (lazy loaded) - these will be loaded when needed
  TrigramLazy: async () => {
    const { TrigramIndex } = await import('./trigram-index.js')
    return TrigramIndex
  },
  
  FullText: async () => {
    const { FullTextIndex } = await import('./fulltext-index.js')
    return FullTextIndex
  },
  
  Hash: async () => {
    const { HashIndex } = await import('./hash-index.js')
    return HashIndex
  }
} as const

export type IndexTypeKey = keyof typeof IndexTypes