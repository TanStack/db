// Demo: Understanding Fuzzy Matching and Thresholds

import { TrigramIndex, IndexOperation } from './packages/db/src/index.js'

// Mock expression for testing
const mockExpression = { type: 'ref' as const, path: ['text'], __returnType: undefined as any }

console.log('🔍 Understanding Fuzzy Matching and Thresholds')
console.log('==============================================')

// Sample data with typos and variations
const testData = [
  { id: '1', text: 'JavaScript' },
  { id: '2', text: 'javascript' },      // case difference
  { id: '3', text: 'JavaScrpit' },      // 1 typo (missing 'i')
  { id: '4', text: 'JavaScriptt' },     // 1 typo (extra 't')
  { id: '5', text: 'JvaScript' },       // 1 typo (missing 'a')
  { id: '6', text: 'TypeScript' },      // different but similar word
  { id: '7', text: 'Python' },          // completely different
  { id: '8', text: 'JS' },              // abbreviation
]

// Test different threshold values
const thresholds = [0.1, 0.3, 0.5, 0.7, 0.9]

console.log('\nSearching for "JavaScript" with different thresholds:')
console.log('=====================================================')

for (const threshold of thresholds) {
  console.log(`\n📊 Threshold: ${threshold} (${Math.round(threshold * 100)}% similarity required)`)
  
  // Create index with this threshold
  const index = new TrigramIndex('test', mockExpression, undefined, { 
    threshold,
    caseSensitive: false  // Case insensitive for this demo
  })
  
  // Add all test data
  testData.forEach(item => index.add(item.id, item))
  
  // Search for "JavaScript" using fuzzy matching
  const results = index.lookup(IndexOperation.FUZZY, 'JavaScript')
  
  console.log('  Matches:')
  for (const id of results) {
    const item = testData.find(d => d.id === id)
    console.log(`    ${id}: "${item?.text}"`)
  }
  
  if (results.size === 0) {
    console.log('    (no matches)')
  }
}

// Demonstrate how similarity is calculated
console.log('\n🧮 How Similarity is Calculated (Jaccard Index)')
console.log('==============================================')

function extractTrigrams(text: string): Set<string> {
  const normalized = text.toLowerCase()
  const padded = `  ${normalized}  `
  const trigrams = new Set<string>()
  
  for (let i = 0; i <= padded.length - 3; i++) {
    trigrams.add(padded.substring(i, i + 3))
  }
  return trigrams
}

function calculateSimilarity(text1: string, text2: string): number {
  const trigrams1 = extractTrigrams(text1)
  const trigrams2 = extractTrigrams(text2)
  
  const intersection = new Set([...trigrams1].filter(t => trigrams2.has(t)))
  const union = new Set([...trigrams1, ...trigrams2])
  
  return intersection.size / union.size
}

const searchTerm = 'JavaScript'
console.log(`\nSimilarity scores for "${searchTerm}":`)

testData.forEach(item => {
  const similarity = calculateSimilarity(searchTerm, item.text)
  const percentage = Math.round(similarity * 100)
  
  console.log(`  "${item.text}" -> ${similarity.toFixed(3)} (${percentage}%)`)
  
  // Show trigram breakdown for the first few
  if (parseInt(item.id) <= 3) {
    const trigrams1 = extractTrigrams(searchTerm)
    const trigrams2 = extractTrigrams(item.text)
    const intersection = new Set([...trigrams1].filter(t => trigrams2.has(t)))
    
    console.log(`    - "${searchTerm}" trigrams: [${Array.from(trigrams1).join(', ')}]`)
    console.log(`    - "${item.text}" trigrams: [${Array.from(trigrams2).join(', ')}]`)
    console.log(`    - Common: [${Array.from(intersection).join(', ')}]`)
    console.log(`    - Formula: ${intersection.size} common / ${trigrams1.size + trigrams2.size - intersection.size} total = ${similarity.toFixed(3)}`)
    console.log('')
  }
})

console.log('\n💡 Threshold Guidelines:')
console.log('========================')
console.log('0.1-0.3: Very permissive (catches many typos, may have false positives)')
console.log('0.3-0.5: Balanced (good for typical typo tolerance)')
console.log('0.5-0.7: Conservative (fewer false positives, may miss some typos)')
console.log('0.7-0.9: Strict (only very similar text)')
console.log('0.9-1.0: Nearly exact (minimal differences only)')

console.log('\n✨ Demo complete!')