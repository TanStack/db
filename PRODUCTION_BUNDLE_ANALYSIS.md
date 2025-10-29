# Production Bundle Analysis (Minified + Gzipped)

**Updated:** October 29, 2025 - With realistic production bundle sizes
**Package:** @tanstack/db v0.4.14
**Testing:** esbuild with `--minify` + gzip compression

## Executive Summary

After testing with **full minification and gzip** (what users actually download), the bundle sizes are **much more reasonable** than initially analyzed:

- **Minimal bundle:** 20.1 KB gzipped (competitive with React/Vue)
- **With Query system:** 21.5 KB gzipped (+1.4 KB)
- **Full featured:** 33.1 KB gzipped (+13 KB)

However, **tree-shaking still isn't working** - there's 40-50% overhead in the minimal bundle due to circular dependencies.

## Detailed Results

### Test Setup

Three import patterns tested with production build settings:

```javascript
// Minimal - Just createCollection
import { createCollection } from '@tanstack/db'

// With Query system
import { createCollection, Query } from '@tanstack/db'

// Full featured
import { createCollection, Query, localStorageCollectionOptions, createLiveQueryCollection } from '@tanstack/db'
```

### Bundle Sizes

| Import Pattern | Unminified | Minified | Gzipped | Compression |
|----------------|------------|----------|---------|-------------|
| Minimal | 176.4 KB | 72.8 KB | **20.1 KB** | 8.8x smaller |
| + Query | 198.9 KB | 78.1 KB | **21.5 KB** | 9.2x smaller |
| Full | 288.9 KB | 116.4 KB | **33.1 KB** | 8.7x smaller |

**Key Insight:** Gzip compression is extremely effective (~9x reduction) because of:
- Repeated code patterns
- Long identifier names
- Whitespace and comments
- Similar code structures

### Comparison to Other Libraries

| Library | Minified | Gzipped | Notes |
|---------|----------|---------|-------|
| React 18 | ~42 KB | ~14 KB | UI library |
| Vue 3 | ~50 KB | ~16 KB | UI framework |
| Zustand | ~3.5 KB | ~1.5 KB | State management |
| Jotai | ~5 KB | ~2 KB | Atomic state |
| **TanStack DB (minimal)** | **72.8 KB** | **20.1 KB** | Data sync + collections |
| **TanStack DB (full)** | **116.4 KB** | **33.1 KB** | + Query system + localStorage |

**Verdict:** TanStack DB is in the same ballpark as major frameworks, not bloated.

## Tree-Shaking Analysis (Still Relevant)

### What Gets Bundled (Even in Minimal Import)

Analysis of the minified bundle shows these components are included:

| Component | Unminified | Minified | Gzipped (est.) | Needed? |
|-----------|------------|----------|----------------|---------|
| Collection core | ~30 KB | ~12 KB | ~4 KB | ✅ Yes |
| Transaction system | ~11 KB | ~4 KB | ~1.5 KB | ✅ Yes |
| B+ Tree | ~25 KB | ~10 KB | ~3 KB | ⚠️ Only if using `compare` |
| Proxy utilities | ~20 KB | ~8 KB | ~2.5 KB | ⚠️ Only if using optimistic updates |
| Query optimizer | ~14 KB | ~5 KB | ~1.5 KB | ❌ Circular dependency |
| localStorage | ~10 KB | ~4 KB | ~1.2 KB | ❌ Not imported! |
| SortedMap + utils | ~30 KB | ~12 KB | ~4 KB | ✅ Yes |
| Errors | ~17 KB | ~7 KB | ~2 KB | ✅ Mostly yes |

**Total minimal bundle:** ~72 KB minified → ~20 KB gzipped

**With perfect tree-shaking:**
- Remove: Query optimizer (1.5 KB), localStorage (1.2 KB)
- Lazy-load: B+ Tree (3 KB), Proxy utils (2.5 KB)
- **Optimal minimal:** ~10-12 KB gzipped

### Savings Potential (Gzipped)

| Optimization | Current | After | Savings | Priority |
|--------------|---------|-------|---------|----------|
| Remove query optimizer | 20.1 KB | ~18.6 KB | ~1.5 KB | High |
| Remove localStorage from minimal | 20.1 KB | ~18.9 KB | ~1.2 KB | Medium |
| Lazy-load B+ Tree | 20.1 KB | ~17 KB | ~3 KB | Medium |
| Lazy-load proxy utilities | 20.1 KB | ~17.5 KB | ~2.5 KB | Low |
| **All optimizations combined** | 20.1 KB | **~10-12 KB** | **~8-10 KB (40-50%)** | - |

## Updated Recommendations

### Priority 1: Fix Circular Dependencies (High Impact on Minimal Bundle)

**Impact:** Save ~3-4 KB gzipped (~15-20% reduction)

The circular dependency `collection/subscription.js → query/optimizer.js` pulls in 1.5 KB gzipped that shouldn't be there.

**Solution:**
- Move query-dependent code out of collection core
- Make query optimizer optional/injectable
- Break the circular dependency

### Priority 2: Entry Point Splitting (Better Developer Experience)

**Impact:** Enable users to opt into smaller bundles

Even though 20 KB is reasonable, some use cases only need 10-12 KB:

```javascript
// For lightweight apps
import { createCollection } from '@tanstack/db/core'  // ~12 KB gzipped

// For query-heavy apps
import { createCollection, Query } from '@tanstack/db'  // ~21 KB gzipped
```

### Priority 3: Lazy Loading Heavy Features (Medium Impact)

**Impact:** Save ~3-5 KB for users who don't need these features

- B+ Tree: Load only when `compare` function is used (~3 KB gzipped)
- Proxy utilities: Load only for optimistic updates (~2.5 KB gzipped)

## Revised Conclusions

### Good News

1. **Production bundle sizes are reasonable:** 20 KB gzipped is competitive
2. **Query system is lightweight:** Only adds 1.4 KB gzipped
3. **Gzip compression is effective:** 8-9x reduction from unminified

### Bad News

1. **Tree-shaking doesn't work:** 40-50% unnecessary code in minimal bundle
2. **Circular dependencies:** Collection code imports query system
3. **Barrel exports:** Everything loaded at module parse time

### Net Assessment

**Before this analysis:** "Package is bloated! 176 KB is too much!"
**After production testing:** "Package is reasonable at 20 KB, but could be 10-12 KB with better tree-shaking"

### Updated Savings Estimate

| Use Case | Current | Optimal | Savings | Is It Worth It? |
|----------|---------|---------|---------|-----------------|
| Basic Collections | 20.1 KB | 10-12 KB | 8-10 KB (40-50%) | ✅ Yes - significant |
| With Queries | 21.5 KB | 20 KB | 1.5 KB (7%) | ⚠️ Marginal |
| Full Featured | 33.1 KB | 30 KB | 3 KB (9%) | ⚠️ Marginal |

### Recommendation Priority (Revised)

**High Priority:**
1. ✅ Fix circular dependencies (saves 3-4 KB gzipped)
2. ✅ Entry point splitting for `/core` (enables 10 KB gzipped bundles)

**Medium Priority:**
3. ⚠️ Lazy load B+ Tree (saves 3 KB, adds complexity)
4. ⚠️ Document current bundle sizes (set expectations)

**Low Priority:**
5. ⚠️ Lazy load proxy utilities (saves 2.5 KB, rarely worth it)
6. ⚠️ Error class optimization (minimal gzipped impact)

## Comparison: Before vs After Minification

| Metric | Unminified | Minified | Gzipped | Notes |
|--------|------------|----------|---------|-------|
| Minimal bundle | 176.4 KB | 72.8 KB (41%) | 20.1 KB (11%) | What I initially reported |
| Tree-shaking waste | ~100 KB | ~40 KB | ~8-10 KB | Actual production impact |
| Perceived bloat | 😱 Huge! | 😐 Medium | 😊 Reasonable | Reality check |

## Final Verdict

**Initial analysis was correct about the problem (circular deps, no tree-shaking) but overstated the severity.**

- Bundle sizes in production are **reasonable** (20 KB gzipped)
- Tree-shaking **still doesn't work** (40% overhead)
- Optimizations **still worth doing** (could save 8-10 KB)
- But it's **not urgent** - package is functional and competitive

**Recommended action:** Implement Phase 1 optimizations (fix circular deps, add entry points) but recognize this is an enhancement, not a critical fix.

## Updated Metrics for CI

Suggested `size-limit` configuration with realistic targets:

```json
{
  "size-limit": [
    {
      "name": "Core (minimal)",
      "path": "dist/esm/index.js",
      "import": "{ createCollection }",
      "limit": "25 KB",
      "gzip": true
    },
    {
      "name": "With Query System",
      "path": "dist/esm/index.js",
      "import": "{ createCollection, Query }",
      "limit": "27 KB",
      "gzip": true
    },
    {
      "name": "Full Featured",
      "path": "dist/esm/index.js",
      "limit": "40 KB",
      "gzip": true
    }
  ]
}
```

## Key Takeaway

**Don't panic about bundle size!**

The package is **not bloated** - 20 KB gzipped is competitive with major frameworks. However, there are **legitimate optimizations** that could reduce it to 10-12 KB for basic use cases.

The analysis and recommendations are still valid, just less urgent than initially suggested.
