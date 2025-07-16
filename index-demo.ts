// Demo of the new lazy-loading index system

import { createCollection, OrderedIndex, BTreeIndex, IndexTypes } from './packages/db/src/index.js'

// Create a collection
const users = createCollection({
  getKey: (user: any) => user.id,
  startSync: false, // Don't start sync for demo
  sync: {
    sync: () => {} // Dummy sync
  }
})

// Add some sample data
users.insert({ id: '1', name: 'Alice', age: 25, bio: 'Software engineer who loves JavaScript' })
users.insert({ id: '2', name: 'Bob', age: 30, bio: 'Full-stack developer' })
users.insert({ id: '3', name: 'Charlie', age: 35, bio: 'Backend engineer specializing in databases' })

console.log('🚀 New Index System Demo')
console.log('========================')

// 1. Default ordered index (synchronous, immediate) - new naming
console.log('\n1. Creating default ordered index...')
const ageIndex = users.createIndex(row => row.age)
console.log(`✓ Age index created (ready: ${ageIndex.isReady})`)
console.log(`  - Type: Ordered (synchronous)`)
console.log(`  - Keys indexed: ${ageIndex.keyCount}`)

// 2. Ordered index with custom options (new naming)
console.log('\n2. Creating custom ordered index...')
const nameIndex = users.createIndex(row => row.name, {
  indexType: OrderedIndex,
  name: 'name_index',
  options: {
    // Could provide custom compareFn here
  }
})
console.log(`✓ Name index created (ready: ${nameIndex.isReady})`)

// 2b. Backward compatibility - BTreeIndex still works
console.log('\n2b. Backward compatibility - BTreeIndex still works...')
const legacyIndex = users.createIndex(row => row.age, {
  indexType: BTreeIndex, // This is now an alias for OrderedIndex
  name: 'legacy_index'
})
console.log(`✓ Legacy index created (ready: ${legacyIndex.isReady})`)

// 3. Async loader (would be lazy-loaded when collection syncs)
console.log('\n3. Creating async-loaded index...')
const textIndex = users.createIndex(row => row.bio, {
  indexType: async () => {
    console.log('  📦 Loading FullTextIndex...')
    // In real usage, this would be: const { FullTextIndex } = await import('./indexes/fulltext.js')
    // For demo, we'll return OrderedIndex as a placeholder
    return OrderedIndex
  },
  options: {
    language: 'en'
  }
})
console.log(`✓ Text index created (ready: ${textIndex.isReady})`)

// 4. Using convenience helpers
console.log('\n4. Using convenience helpers...')
const bioIndex = users.createIndex(row => row.bio, {
  indexType: IndexTypes.Ordered, // Pre-defined convenience (new naming)
  name: 'bio_search'
})
console.log(`✓ Bio index created (ready: ${bioIndex.isReady})`)

// 4b. Backward compatibility with IndexTypes.BTree
const legacyBioIndex = users.createIndex(row => row.bio, {
  indexType: IndexTypes.BTree, // Still works (backward compatibility)
  name: 'legacy_bio_search'
})
console.log(`✓ Legacy bio index created (ready: ${legacyBioIndex.isReady})`)

// 5. Query demonstration
console.log('\n5. Running queries...')

const adults = users.find({ where: row => row.age >= 30 })
console.log(`✓ Found ${adults.length} adults (age >= 30)`)

const developers = users.find({ where: row => row.bio.includes('developer') })
console.log(`✓ Found ${developers.length} developers`)

// 6. Index statistics
console.log('\n6. Index statistics...')
if (ageIndex.isReady) {
  const stats = ageIndex.getStats()
  console.log(`  Age index: ${stats.entryCount} entries, ${stats.lookupCount} lookups`)
}

console.log('\n✨ Demo complete! All indexes working correctly.')

// Usage patterns summary
console.log('\n📋 Usage Patterns:')
console.log('================')
console.log('// Synchronous (immediate):')
console.log('const index = collection.createIndex(row => row.field)')
console.log('')
console.log('// With options (new naming):')
console.log('const index = collection.createIndex(row => row.field, {')
console.log('  indexType: OrderedIndex,')
console.log('  options: { compareFn: customSort },')
console.log('  name: "my_index"')
console.log('})')
console.log('')
console.log('// Backward compatibility:')
console.log('const index = collection.createIndex(row => row.field, {')
console.log('  indexType: BTreeIndex, // Still works, same as OrderedIndex')
console.log('  options: { compareFn: customSort }')
console.log('})')
console.log('')
console.log('// Async loading:')
console.log('const index = collection.createIndex(row => row.content, {')
console.log('  indexType: async () => {')
console.log('    const { FullTextIndex } = await import("./fulltext.js")')
console.log('    return FullTextIndex')
console.log('  },')
console.log('  options: { language: "en" }')
console.log('})')
console.log('')
console.log('// Check readiness:')
console.log('if (index.isReady) {')
console.log('  console.log(index.getStats())')
console.log('} else {')
console.log('  await index.whenReady()')
console.log('  console.log("Now ready!")')
console.log('}')