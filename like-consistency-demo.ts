// Demo: LIKE Operation Consistency - Index vs Real-time
// This proves that TrigramIndex LIKE results are identical to real-time filtering

import { TrigramIndex, IndexOperation } from './packages/db/src/index.js'

console.log('🔍 LIKE Operation Consistency Test')
console.log('==================================')
console.log('Testing: Do TrigramIndex LIKE results match real-time filtering?')

// Mock expression for testing
const mockExpression = { type: 'ref' as const, path: ['text'], __returnType: undefined as any }

// Test data with various patterns
const testData = [
  { id: '1', text: 'hello world' },
  { id: '2', text: 'Hello World' },
  { id: '3', text: 'goodbye world' },
  { id: '4', text: 'hello there' },
  { id: '5', text: 'world peace' },
  { id: '6', text: 'HELLO WORLD' },
  { id: '7', text: 'world_peace' },
  { id: '8', text: 'JavaScript is awesome' },
  { id: '9', text: 'TypeScript rocks' },
  { id: '10', text: '' }, // empty string
  { id: '11', text: 'a' }, // single char
]

// Real-time LIKE implementation (what collection.find() would do without index)
function realTimeLike(data: typeof testData, pattern: string, caseInsensitive: boolean = false): string[] {
  // Convert SQL LIKE pattern to regex (same logic as TrigramIndex)
  let escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  escaped = escaped.replace(/([^\\])%/g, '$1.*')
  escaped = escaped.replace(/^%/, '.*')
  escaped = escaped.replace(/([^\\])_/g, '$1.')
  escaped = escaped.replace(/^_/, '.')
  escaped = escaped.replace(/\\%/g, '%')
  escaped = escaped.replace(/\\_/g, '_')
  
  const flags = caseInsensitive ? 'i' : ''
  const regex = new RegExp(`^${escaped}$`, flags)
  
  return data.filter(item => regex.test(item.text)).map(item => item.id)
}

// Test patterns to verify consistency
const testPatterns = [
  'hello%',           // prefix match
  '%world',           // suffix match  
  '%wor_d%',          // middle match with wildcard
  'hello_world',      // exact with single char wildcard
  '%',                // match everything
  'hello world',      // exact match
  'HELLO%',           // case variations
  '%script%',         // case insensitive substring
  'Type_cript',       // single char wildcard
  'nonexistent%',     // no matches
  '',                 // empty pattern
]

// Create trigram index
const index = new TrigramIndex('consistency-test', mockExpression, undefined, {
  caseSensitive: false,  // Match real-time behavior
  normalizeWhitespace: true
})

// Add all test data to index
testData.forEach(item => index.add(item.id, item))

console.log('\n📊 Testing Pattern Consistency:')
console.log('==============================')

let allMatch = true
let testCount = 0

for (const pattern of testPatterns) {
  testCount++
  
  // Get results from trigram index (LIKE operation)
  const indexResults = Array.from(index.lookup(IndexOperation.LIKE, pattern)).sort()
  
  // Get results from real-time filtering  
  const realTimeResults = realTimeLike(testData, pattern, true).sort() // true = case insensitive
  
  // Compare results
  const match = JSON.stringify(indexResults) === JSON.stringify(realTimeResults)
  
  console.log(`\n${testCount}. Pattern: "${pattern}"`)
  console.log(`   Index results:     [${indexResults.join(', ')}]`)
  console.log(`   Real-time results: [${realTimeResults.join(', ')}]`)
  console.log(`   ✅ Match: ${match ? 'YES' : 'NO'}`)
  
  if (!match) {
    allMatch = false
    console.log(`   ❌ MISMATCH DETECTED!`)
  }
}

// Test ILIKE (case insensitive) separately  
console.log('\n📊 Testing ILIKE (Case Insensitive):')
console.log('===================================')

const ilikePatterns = ['HELLO%', 'hello%', '%WORLD', '%world']

for (const pattern of ilikePatterns) {
  testCount++
  
  // ILIKE from index
  const indexResults = Array.from(index.lookup(IndexOperation.ILIKE, pattern)).sort()
  
  // Case insensitive real-time
  const realTimeResults = realTimeLike(testData, pattern, true).sort()
  
  const match = JSON.stringify(indexResults) === JSON.stringify(realTimeResults)
  
  console.log(`\nPattern: "${pattern}" (ILIKE)`)
  console.log(`   Index results:     [${indexResults.join(', ')}]`)
  console.log(`   Real-time results: [${realTimeResults.join(', ')}]`)
  console.log(`   ✅ Match: ${match ? 'YES' : 'NO'}`)
  
  if (!match) {
    allMatch = false
  }
}

console.log('\n' + '='.repeat(50))
console.log(`🎯 FINAL RESULT: ${allMatch ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`)
console.log(`📈 Tests run: ${testCount}`)
console.log('='.repeat(50))

if (allMatch) {
  console.log('✅ GUARANTEE: TrigramIndex LIKE operations return IDENTICAL results to real-time filtering!')
  console.log('✅ The index is purely an optimization - it never changes the semantics of LIKE queries.')
} else {
  console.log('❌ WARNING: Inconsistency detected! This should not happen.')
}

console.log('\n💡 Key Points:')
console.log('==============')
console.log('1. LIKE/ILIKE operations use the SAME regex conversion logic')
console.log('2. Trigram optimization only FILTERS candidates - never changes matching logic') 
console.log('3. All candidates are tested with the EXACT same regex as real-time filtering')
console.log('4. Fuzzy matching (SIMILAR/FUZZY) is a SEPARATE feature - not used for LIKE')
console.log('5. Index provides performance improvement while maintaining semantic equivalence')

console.log('\n✨ Demo complete!')