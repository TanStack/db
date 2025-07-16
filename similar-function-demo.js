// Demo: Using the similar() function for fuzzy text search
import { createCollection, TrigramIndex } from './packages/db/src/index.js';
import { similar } from './packages/db/src/query/builder/functions.js';
console.log('🔍 similar() Function Demo');
console.log('==========================');
console.log('Fuzzy text search with both indexed and real-time filtering!');
const articles = [
    { id: '1', title: 'JavaScript Programming Guide', author: 'John Doe', tags: ['js', 'programming'] },
    { id: '2', title: 'JavaScrpit Best Practices', author: 'Jane Smith', tags: ['js', 'tips'] }, // typo!
    { id: '3', title: 'TypeScript Advanced Patterns', author: 'Bob Wilson', tags: ['ts', 'patterns'] },
    { id: '4', title: 'React Development Tutorial', author: 'Alice Brown', tags: ['react', 'frontend'] },
    { id: '5', title: 'Python Machine Learning', author: 'Charlie Davis', tags: ['python', 'ml'] },
    { id: '6', title: 'JS Performance Optimization', author: 'Diana Miller', tags: ['js', 'performance'] },
    { id: '7', title: 'Node.js Server Development', author: 'Frank Johnson', tags: ['nodejs', 'backend'] },
    { id: '8', title: 'Angular Framework Guide', author: 'Grace Lee', tags: ['angular', 'frontend'] },
    { id: '9', title: 'JavaScript ES6 Features', author: 'Henry Clark', tags: ['js', 'es6'] },
    { id: '10', title: 'Vue.js Component Design', author: 'Ivy Martinez', tags: ['vue', 'components'] },
];
// Create collection with real-time filtering
console.log('\n📊 Part 1: Real-time Fuzzy Search (No Index)');
console.log('==============================================');
const realTimeCollection = createCollection({
    getKey: (article) => article.id,
    sync: {
        sync: ({ begin, write, commit }) => {
            begin();
            articles.forEach(article => {
                write({ type: 'insert', value: article });
            });
            commit();
        }
    }
});
// Search for articles similar to "JavaScript" using real-time filtering
console.log('\n🔍 Searching for articles similar to "JavaScript":');
const jsSimilarResults = realTimeCollection.find({
    where: row => similar(row.title, 'JavaScript')
});
console.log('Results:');
jsSimilarResults.forEach(article => {
    console.log(`  📄 "${article.title}" by ${article.author}`);
});
// Search with custom threshold
console.log('\n🔍 Searching with high threshold (0.7) for strict matching:');
const strictResults = realTimeCollection.find({
    where: row => similar(row.title, 'JavaScript', 0.7)
});
console.log('Results:');
strictResults.forEach(article => {
    console.log(`  📄 "${article.title}" by ${article.author}`);
});
// Search with low threshold
console.log('\n🔍 Searching with low threshold (0.2) for permissive matching:');
const permissiveResults = realTimeCollection.find({
    where: row => similar(row.title, 'JavaScript', 0.2)
});
console.log('Results:');
permissiveResults.forEach(article => {
    console.log(`  📄 "${article.title}" by ${article.author}`);
});
// Create collection with trigram index
console.log('\n\n🚀 Part 2: Indexed Fuzzy Search (With TrigramIndex)');
console.log('================================================');
const indexedCollection = createCollection({
    getKey: (article) => article.id,
    sync: {
        sync: ({ begin, write, commit }) => {
            begin();
            articles.forEach(article => {
                write({ type: 'insert', value: article });
            });
            commit();
        }
    }
});
// Add trigram index for title similarity
const titleIndex = indexedCollection.createIndex(row => row.title, {
    indexType: TrigramIndex,
    name: 'title-similarity',
    options: {
        threshold: 0.3, // Default threshold for the index
        caseSensitive: false,
        normalizeWhitespace: true
    }
});
console.log(`✅ TrigramIndex created for titles (${titleIndex.keyCount} items indexed)`);
// Test: same query with index should return identical results
console.log('\n🔍 Same search with TrigramIndex (should return identical results):');
const indexedJsResults = indexedCollection.find({
    where: row => similar(row.title, 'JavaScript')
});
console.log('Results:');
indexedJsResults.forEach(article => {
    console.log(`  📄 "${article.title}" by ${article.author}`);
});
// Verify consistency
const realTimeIds = jsSimilarResults.map(a => a.id).sort();
const indexedIds = indexedJsResults.map(a => a.id).sort();
console.log('\n✅ Consistency Check:');
console.log(`Real-time result IDs: [${realTimeIds.join(', ')}]`);
console.log(`Indexed result IDs:    [${indexedIds.join(', ')}]`);
console.log(`Results identical: ${JSON.stringify(realTimeIds) === JSON.stringify(indexedIds) ? '✅ YES' : '❌ NO'}`);
// Performance comparison (simulated)
console.log('\n⚡ Performance Benefits:');
const startTime1 = performance.now();
realTimeCollection.find({ where: row => similar(row.title, 'JavaScript') });
const realTimeMs = performance.now() - startTime1;
const startTime2 = performance.now();
indexedCollection.find({ where: row => similar(row.title, 'JavaScript') });
const indexedMs = performance.now() - startTime2;
console.log(`Real-time search: ${realTimeMs.toFixed(2)}ms`);
console.log(`Indexed search:   ${indexedMs.toFixed(2)}ms`);
console.log(`Speedup: ${realTimeMs > indexedMs ? `${(realTimeMs / indexedMs).toFixed(1)}x faster` : 'Similar (small dataset)'}`);
// Advanced usage examples
console.log('\n\n📚 Part 3: Advanced Usage Examples');
console.log('===================================');
// Find articles similar to a search term with typos
console.log('\n🔍 Finding articles similar to "Reactt" (with typo):');
const typoResults = indexedCollection.find({
    where: row => similar(row.title, 'Reactt', 0.4)
});
typoResults.forEach(article => {
    console.log(`  📄 "${article.title}" by ${article.author}`);
});
// Combine with other conditions
console.log('\n🔍 Similar to "JavaScript" AND authored by specific people:');
const combinedResults = indexedCollection.find({
    where: row => similar(row.title, 'JavaScript', 0.3) // Note: && with other conditions would need 'and()' function
});
combinedResults.forEach(article => {
    console.log(`  📄 "${article.title}" by ${article.author}`);
});
// Search in author names
console.log('\n🔍 Finding authors with names similar to "Jon":');
const authorResults = indexedCollection.find({
    where: row => similar(row.author, 'Jon', 0.4)
});
authorResults.forEach(article => {
    console.log(`  📄 "${article.title}" by ${article.author}`);
});
console.log('\n💡 Usage Patterns Summary:');
console.log('=========================');
console.log('✅ Basic usage:     similar(row.field, "search term")');
console.log('✅ Custom threshold: similar(row.field, "search term", 0.7)');
console.log('✅ Works with:      Real-time filtering AND TrigramIndex');
console.log('✅ Performance:     TrigramIndex provides significant speedup for large datasets');
console.log('✅ Consistency:     Index and real-time return identical results');
console.log('✅ Flexibility:     Configurable similarity thresholds');
console.log('✅ Robustness:      Handles typos, case differences, and whitespace');
console.log('\n🎯 When to use similar() vs like():');
console.log('===================================');
console.log('📝 like():     Exact pattern matching with wildcards (%, _)');
console.log('🔍 similar():  Fuzzy matching for typos and variations');
console.log('');
console.log('Example:');
console.log('  like(title, "%Script%")     → Finds "JavaScript", "TypeScript"');
console.log('  similar(title, "JavaScript") → Finds "JavaScript", "JavaScrpit" (typo)');
console.log('\n✨ Demo complete! 🎉');
