// Demo of the new TrigramIndex for text search and LIKE operations

import { createCollection, TrigramIndex, IndexTypes } from './packages/db/src/index.js'
import { like, ilike } from './packages/db/src/query/builder/functions.js'

// Sample data - a collection of articles
interface Article {
  id: string
  title: string
  content: string
  author: string
  tags: string[]
}

const articles: Article[] = [
  {
    id: '1',
    title: 'Getting Started with TypeScript',
    content: 'TypeScript is a powerful superset of JavaScript that adds static typing...',
    author: 'John Doe',
    tags: ['typescript', 'javascript', 'programming']
  },
  {
    id: '2',
    title: 'Advanced React Patterns',
    content: 'Learn about advanced patterns in React including hooks, context, and performance optimization...',
    author: 'Jane Smith',
    tags: ['react', 'javascript', 'frontend']
  },
  {
    id: '3',
    title: 'Database Indexing Strategies',
    content: 'Effective indexing strategies for better database performance. Learn about B-trees, hash indexes, and trigram indexes...',
    author: 'Mike Johnson',
    tags: ['database', 'performance', 'indexing']
  },
  {
    id: '4',
    title: 'Node.js Performance Optimization',
    content: 'Tips and tricks for optimizing Node.js applications including memory management and async patterns...',
    author: 'Sarah Wilson',
    tags: ['nodejs', 'javascript', 'performance']
  },
  {
    id: '5',
    title: 'Machine Learning with Python',
    content: 'Introduction to machine learning concepts using Python and popular libraries like scikit-learn...',
    author: 'David Chen',
    tags: ['python', 'ml', 'data-science']
  }
]

// Create articles collection
const articlesCollection = createCollection<Article, string>({
  getKey: (article) => article.id,
  sync: {
    sync: ({ begin, write, commit }) => {
      begin()
      articles.forEach(article => {
        write({ type: 'insert', value: article })
      })
      commit()
    }
  }
})

console.log('🔍 TrigramIndex Demo for Text Search')
console.log('====================================')

// 1. Create trigram index on article titles
console.log('\n1. Creating trigram index on article titles...')
const titleIndex = articlesCollection.createIndex(row => row.title, {
  indexType: TrigramIndex,
  name: 'title_search',
  options: {
    threshold: 0.3,
    caseSensitive: false,
    normalizeWhitespace: true
  }
})

console.log(`✓ Title index created (ready: ${titleIndex.isReady})`)
console.log(`  - Keys indexed: ${titleIndex.keyCount}`)

// 2. Create trigram index on article content
console.log('\n2. Creating trigram index on article content...')
const contentIndex = articlesCollection.createIndex(row => row.content, {
  indexType: TrigramIndex,
  name: 'content_search'
})

console.log(`✓ Content index created (ready: ${contentIndex.isReady})`)

// 3. Demonstrate LIKE queries
console.log('\n3. Running LIKE queries...')

// Search for articles with "Type" in title (case insensitive)
console.log('\n📝 Articles with "Type" in title:')
const typeArticles = articlesCollection.find({
  where: row => like(row.title, '%Type%')
})
typeArticles.forEach(article => {
  console.log(`  - "${article.title}" by ${article.author}`)
})

// Search for articles with "React" in title (case insensitive)
console.log('\n⚛️ Articles about React:')
const reactArticles = articlesCollection.find({
  where: row => ilike(row.title, '%react%')
})
reactArticles.forEach(article => {
  console.log(`  - "${article.title}" by ${article.author}`)
})

// Search in content for "performance"
console.log('\n🚀 Articles mentioning "performance":')
const perfArticles = articlesCollection.find({
  where: row => like(row.content, '%performance%')
})
perfArticles.forEach(article => {
  console.log(`  - "${article.title}" by ${article.author}`)
})

// Complex LIKE pattern
console.log('\n🔍 Articles with titles starting with vowels:')
const vowelArticles = articlesCollection.find({
  where: row => like(row.title, '[AEIOU]%')
})
vowelArticles.forEach(article => {
  console.log(`  - "${article.title}" by ${article.author}`)
})

// 4. Show index statistics
console.log('\n4. Index statistics:')
if (titleIndex.isReady) {
  const titleStats = titleIndex.getStats()
  console.log(`📊 Title index:`)
  console.log(`  - Entries: ${titleStats.entryCount}`)
  console.log(`  - Memory usage: ${Math.round(titleStats.memoryUsage / 1024)}KB`)
  console.log(`  - Lookups performed: ${titleStats.lookupCount}`)
  console.log(`  - Avg lookup time: ${titleStats.averageLookupTime.toFixed(2)}ms`)

  // Get trigram-specific stats
  const trigramStats = (titleIndex as any).getTrigramStats?.()
  if (trigramStats) {
    console.log(`  - Unique trigrams: ${trigramStats.uniqueTrigrams}`)
    console.log(`  - Avg trigrams per title: ${trigramStats.averageTrigramsPerKey.toFixed(1)}`)
    console.log(`  - Most common trigrams:`)
    trigramStats.mostCommonTrigrams.slice(0, 5).forEach(([trigram, count]) => {
      console.log(`    "${trigram}": ${count} occurrences`)
    })
  }
}

// 5. Demonstrate fuzzy search (similarity)
console.log('\n5. Fuzzy search demonstration:')
console.log('🔍 Searching for articles similar to "TypeScrpit" (with typo):')

// This would require implementing similarity search in collection queries
// For now, we'll show how it would work with direct index access
if (titleIndex.isReady) {
  console.log('   (Note: Direct similarity search would require additional query functions)')
  console.log('   (The TrigramIndex supports SIMILAR and FUZZY operations internally)')
}

// 6. Performance comparison
console.log('\n6. Performance benefits:')
console.log('✅ With TrigramIndex:')
console.log('  - LIKE queries use trigram optimization')
console.log('  - Only candidates matching trigrams are tested')
console.log('  - Fuzzy/similarity search available')
console.log('  - Case-insensitive search supported')

console.log('\n❌ Without TrigramIndex:')
console.log('  - LIKE queries scan all records')
console.log('  - No fuzzy search capability')
console.log('  - Slower for large datasets')

// 7. Usage patterns summary
console.log('\n📋 Usage Patterns:')
console.log('================')
console.log('// Create trigram index for text search:')
console.log('const textIndex = collection.createIndex(row => row.textField, {')
console.log('  indexType: TrigramIndex,')
console.log('  options: {')
console.log('    threshold: 0.3,      // Similarity threshold (0-1)')
console.log('    caseSensitive: false, // Case insensitive by default')
console.log('    normalizeWhitespace: true // Normalize spaces')
console.log('  }')
console.log('})')
console.log('')
console.log('// Use LIKE queries:')
console.log('const results = collection.find({')
console.log('  where: row => like(row.textField, "%search%")')
console.log('})')
console.log('')
console.log('// Case-insensitive LIKE:')
console.log('const results = collection.find({')
console.log('  where: row => ilike(row.textField, "%SEARCH%")')
console.log('})')

console.log('\n✨ Demo complete! TrigramIndex provides efficient text search.')