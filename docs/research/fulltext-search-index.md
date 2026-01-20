# Full-Text Search Index Research for TanStack DB

## Context

Based on [PR #950](https://github.com/TanStack/db/pull/950), TanStack DB is moving toward opt-in, tree-shakeable indexing. This document researches JavaScript full-text search options that could integrate with this architecture.

## Requirements for TanStack DB Integration

Based on the existing `IndexInterface` in `packages/db/src/indexes/base-index.ts`, a full-text search index would need to:

1. **Implement core interface methods**: `add()`, `remove()`, `update()`, `build()`, `clear()`
2. **Support dynamic updates**: Documents can be added/removed at any time (unlike Lunr.js which is immutable)
3. **Be tree-shakeable**: Support lazy loading via async resolver pattern
4. **Work in browser and Node.js**: No server-side dependencies
5. **Be reasonably small**: Bundle size matters for client-side use
6. **Support relevance scoring**: Full-text search implies ranked results

### Additional Full-Text Specific Operations

A full-text index would likely extend `IndexInterface` with:
- `search(query: string, options?: SearchOptions): SearchResult[]`
- `suggest(prefix: string): string[]` (autocomplete)
- `highlight(docId, query): HighlightedText`

---

## JavaScript Full-Text Search Libraries Comparison

### 1. Orama (Recommended)

**GitHub**: https://github.com/oramasearch/orama
**License**: Apache 2.0
**Bundle Size**: ~2KB gzipped (core)

#### Strengths
- ✅ **Already used by TanStack**: tanstack.com uses Orama for search
- ✅ **Tiny bundle**: Under 2KB for full-text search
- ✅ **Dynamic updates**: Full add/remove/update support
- ✅ **Modern TypeScript**: Written in TypeScript with excellent types
- ✅ **Feature-rich**: Typo tolerance, stemming (30 languages), facets, geo-search
- ✅ **Vector search support**: Enables hybrid full-text + semantic search
- ✅ **Microsecond latency**: Very fast search performance
- ✅ **Plugin architecture**: Extensible design matches TanStack DB's philosophy

#### API Example
```typescript
import { create, insert, remove, search } from '@orama/orama'

const db = create({
  schema: {
    title: 'string',
    content: 'string',
    tags: 'string[]'
  }
})

insert(db, { title: 'Hello World', content: 'Full-text search example', tags: ['demo'] })

const results = search(db, {
  term: 'search',
  properties: ['title', 'content'],
  tolerance: 1  // typo tolerance
})
```

#### Integration Considerations
- Functional API (not class-based) - would need wrapper
- Schema must be defined upfront
- Could be exposed as `@tanstack/db-search` or similar

---

### 2. MiniSearch

**GitHub**: https://github.com/lucaong/minisearch
**License**: MIT
**Bundle Size**: ~7KB gzipped

#### Strengths
- ✅ **Memory efficient**: Designed for constrained environments
- ✅ **Dynamic updates**: Full add/remove support
- ✅ **Auto-suggestions**: Built-in autocomplete
- ✅ **Fuzzy search**: Configurable typo tolerance
- ✅ **Simple API**: Easy to integrate
- ✅ **Zero dependencies**: No external deps

#### Weaknesses
- ❌ **No stemming built-in**: Must be added manually
- ❌ **Larger than Orama**: ~3.5x bigger bundle
- ❌ **No vector search**: Full-text only

#### API Example
```typescript
import MiniSearch from 'minisearch'

const miniSearch = new MiniSearch({
  fields: ['title', 'content'],
  storeFields: ['title']
})

miniSearch.addAll(documents)
miniSearch.add({ id: 1, title: 'New doc', content: '...' })
miniSearch.remove({ id: 1 })

const results = miniSearch.search('query', { fuzzy: 0.2, prefix: true })
```

#### Integration Considerations
- Class-based API fits well with TanStack DB's index pattern
- Would need ID-based tracking like existing `BTreeIndex`

---

### 3. FlexSearch

**GitHub**: https://github.com/nextapps-de/flexsearch
**License**: Apache 2.0
**Bundle Size**: 4.5KB (light) to 16.3KB (full) gzipped

#### Strengths
- ✅ **Extremely fast**: Claims fastest JS search library
- ✅ **Web Workers support**: Parallel indexing/searching
- ✅ **Persistent indexes**: Can serialize to storage
- ✅ **Phonetic search**: Advanced matching algorithms
- ✅ **Multiple presets**: Configurable memory/speed tradeoffs

#### Weaknesses
- ❌ **Complex API**: Steeper learning curve
- ❌ **Inconsistent documentation**: API has changed across versions
- ❌ **Memory vs speed tradeoff**: Fast modes use more memory

#### API Example
```typescript
import { Document } from 'flexsearch'

const index = new Document({
  document: {
    id: 'id',
    index: ['title', 'content']
  }
})

index.add({ id: 1, title: 'Hello', content: 'World' })
index.remove(1)

const results = index.search('hello')
```

#### Integration Considerations
- Document search mode matches TanStack DB's collection model
- Would need careful version pinning due to API instability

---

### 4. Fuse.js

**GitHub**: https://github.com/krisk/Fuse
**License**: Apache 2.0
**Bundle Size**: ~12KB gzipped

#### Strengths
- ✅ **Fuzzy search focus**: Best-in-class approximate matching
- ✅ **Weighted fields**: Different importance per field
- ✅ **Well maintained**: Large community
- ✅ **Simple API**: Easy to use

#### Weaknesses
- ❌ **No inverted index**: Scans all documents (O(n))
- ❌ **Poor performance at scale**: Not suitable for large datasets
- ❌ **No tokenization**: Matches substrings, not words

#### API Example
```typescript
import Fuse from 'fuse.js'

const fuse = new Fuse(documents, {
  keys: ['title', 'content'],
  threshold: 0.3
})

const results = fuse.search('query')
```

#### Integration Considerations
- **Not recommended** for full-text search - better for small fuzzy matching
- Could be useful as a lightweight "fuzzy filter" on top of other indexes

---

### 5. Lunr.js

**GitHub**: https://github.com/olivernn/lunr.js
**License**: MIT
**Bundle Size**: ~8KB gzipped

#### Strengths
- ✅ **Built-in stemming**: Multiple language support
- ✅ **TF-IDF scoring**: Good relevance ranking
- ✅ **Mature**: Battle-tested library

#### Weaknesses
- ❌ **Immutable index**: Cannot add/remove documents after build
- ❌ **No maintenance**: Last commit was years ago
- ❌ **Rebuild required**: Any change requires full reindex

#### Integration Considerations
- **Not recommended** due to immutable index - doesn't fit TanStack DB's real-time update model

---

### 6. Build Custom (Inverted Index)

Building a minimal custom full-text index is feasible for basic needs.

#### Core Components
```typescript
class FullTextIndex implements IndexInterface {
  private invertedIndex = new Map<string, Set<Key>>()  // term -> doc keys
  private docTerms = new Map<Key, Set<string>>()       // doc -> terms (for removal)

  add(key: Key, item: any) {
    const text = this.extractText(item)
    const terms = this.tokenize(text)

    this.docTerms.set(key, new Set(terms))
    for (const term of terms) {
      if (!this.invertedIndex.has(term)) {
        this.invertedIndex.set(term, new Set())
      }
      this.invertedIndex.get(term)!.add(key)
    }
  }

  remove(key: Key, item: any) {
    const terms = this.docTerms.get(key)
    if (!terms) return

    for (const term of terms) {
      this.invertedIndex.get(term)?.delete(key)
    }
    this.docTerms.delete(key)
  }

  search(query: string): Set<Key> {
    const queryTerms = this.tokenize(query)
    // AND logic: intersection of all term matches
    let result: Set<Key> | null = null
    for (const term of queryTerms) {
      const matches = this.invertedIndex.get(term) ?? new Set()
      result = result ? intersection(result, matches) : new Set(matches)
    }
    return result ?? new Set()
  }

  private tokenize(text: string): string[] {
    return text.toLowerCase()
      .split(/\W+/)
      .filter(t => t.length > 1)
  }
}
```

#### Strengths
- ✅ **Zero dependencies**: Complete control
- ✅ **Minimal size**: Can be very small
- ✅ **Perfect fit**: Matches TanStack DB interface exactly

#### Weaknesses
- ❌ **No advanced features**: No fuzzy, stemming, scoring
- ❌ **Maintenance burden**: Must build everything
- ❌ **No relevance ranking**: Basic boolean matching only

---

## Recommendation

### Primary: **Orama**

Orama is the strongest candidate because:

1. **Already in TanStack ecosystem** - tanstack.com uses it, so there's familiarity
2. **Smallest bundle** - Under 2KB for core functionality
3. **Most features** - Typo tolerance, stemming, facets, vector search
4. **Modern TypeScript** - Excellent type safety
5. **Apache 2.0** - Compatible license
6. **Active maintenance** - Regular updates and community

### Implementation Approach

```typescript
// packages/db-search/src/fulltext-index.ts
import { create, insert, remove, search, type Orama } from '@orama/orama'
import type { BaseIndex, IndexInterface } from '@tanstack/db'

export class FullTextIndex<TKey extends string | number>
  extends BaseIndex<TKey>
  implements IndexInterface<TKey> {

  private db: Orama<any>
  private keyField: string
  private textFields: string[]

  constructor(
    id: number,
    expression: BasicExpression,
    name?: string,
    options?: FullTextIndexOptions
  ) {
    super(id, expression, name)
    this.textFields = options?.fields ?? []
    this.keyField = options?.keyField ?? 'id'

    this.db = create({
      schema: this.buildSchema()
    })
  }

  add(key: TKey, item: any): void {
    insert(this.db, { [this.keyField]: key, ...item })
  }

  remove(key: TKey, item: any): void {
    remove(this.db, key)
  }

  // Full-text specific method
  search(query: string, options?: SearchOptions): SearchResult<TKey>[] {
    return search(this.db, {
      term: query,
      properties: this.textFields,
      ...options
    })
  }

  // For basic IndexInterface compatibility
  lookup(operation: 'search', value: string): Set<TKey> {
    const results = this.search(value)
    return new Set(results.map(r => r.id as TKey))
  }
}
```

### Alternative: MiniSearch

If Orama's functional API is problematic, MiniSearch's class-based design is a good fallback:
- Larger bundle (~7KB) but still reasonable
- Simpler integration with existing index patterns
- MIT license (very permissive)

---

## Bundle Size Comparison

| Library | Size (gzip) | Dynamic Updates | Fuzzy | Stemming |
|---------|-------------|-----------------|-------|----------|
| Orama | ~2KB | ✅ | ✅ | ✅ (30 langs) |
| MiniSearch | ~7KB | ✅ | ✅ | ❌ (addon) |
| FlexSearch (light) | ~4.5KB | ✅ | ✅ | ✅ |
| Fuse.js | ~12KB | ✅ | ✅ | ❌ |
| Lunr.js | ~8KB | ❌ | ❌ | ✅ |
| Custom | ~1KB | ✅ | ❌ | ❌ |

---

## Next Steps

1. **Prototype Orama integration** as `@tanstack/db-search`
2. **Design extended IndexInterface** for full-text operations
3. **Add to tree-shakeable entry points** per PR #950 pattern
4. **Benchmark** against existing BTreeIndex for mixed workloads
5. **Document** field configuration and search options

---

## Sources

- [Orama GitHub](https://github.com/oramasearch/orama)
- [MiniSearch GitHub](https://github.com/lucaong/minisearch)
- [FlexSearch GitHub](https://github.com/nextapps-de/flexsearch)
- [Fuse.js](https://www.fusejs.io/)
- [Lunr.js](https://lunrjs.com/)
- [JS Search Library Comparisons](https://npm-compare.com/elasticlunr,flexsearch,fuse.js,minisearch)
- [Best Search Packages for JavaScript](https://mattermost.com/blog/best-search-packages-for-javascript/)
- [Top 6 JavaScript Search Libraries](https://byby.dev/js-search-libraries)
- [Inverted Index Implementation](https://www.30secondsofcode.org/js/s/tf-idf-inverted-index/)
