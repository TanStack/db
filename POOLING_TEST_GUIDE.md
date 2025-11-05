# Query Pooling Integration - Testing Guide

## ✅ Setup Complete

The query pooling system has been integrated and the test2 application is configured to use it.

## 🚀 How to Test

### 1. Start the Test Application

The dev server is already running at: **http://localhost:5173/**

```bash
# If not already running:
cd test2-app
npm run dev
```

### 2. Open Browser Console

1. Open the application in your browser: http://localhost:5173/
2. Open Developer Tools (F12 or Cmd+Option+I)
3. Go to the Console tab

### 3. Verify Pooling is Active

You should see console messages like:

```
[TanStack DB Pooling] Using pooled query for collection: orders params: { item.rowId: "0|0", item.side: "a" }
[TanStack DB Pooling] Using pooled query for collection: orders params: { item.rowId: "0|0", item.side: "b" }
[TanStack DB Pooling] Using pooled query for collection: orders params: { item.rowId: "0|1", item.side: "a" }
...
```

**Expected:** You should see ~240 of these messages (12 grids × 10 rows × 2 sides)

**If you see:** `[TanStack DB] Query not poolable, using standard approach. Reason: ...`
- This means the query didn't match the poolable pattern
- Check the reason in the console message

### 4. Measure Performance

#### Method 1: Chrome Performance Tab

1. Open DevTools → Performance tab
2. Click Record
3. Refresh the page (Cmd+R / Ctrl+R)
4. Stop recording after page loads
5. Look for "Interaction" events and measure the time

#### Method 2: Manual Tab Switching

1. Switch between Tab 1 and Tab 2 at the top of the page
2. In Console, run:
   ```javascript
   // Measure tab switch performance
   performance.mark('start');
   // Click a tab
   performance.mark('end');
   performance.measure('tab-switch', 'start', 'end');
   console.log(performance.getEntriesByName('tab-switch')[0].duration);
   ```

### 5. Compare with Redux Version

1. Open http://localhost:5173/?redux
2. This loads the Redux version (no pooling)
3. Compare performance using the same methods above

## 📊 Expected Results

### With Pooling (TanStack Version)

- **Query Creation**: ~240 pooled queries detected in console
- **Subscriptions**: 1 shared subscription per collection (visible in logs)
- **Initial Load**: Should be 40-50% faster than before pooling
- **Tab Switching**: Minimal re-rendering, only affected components update

### Baseline (Redux Version)

- **Initial Load**: ~63ms on fast machine, ~194ms with 4x throttle
- **Goal**: TanStack with pooling should be competitive or faster

## 🔍 What to Look For

### Console Logs Analysis

Count the messages:
```javascript
// In browser console
const pooled = performance.getEntriesByType('measure')
  .filter(m => m.name.includes('pooled')).length;
console.log(`Pooled queries: ${pooled}`);
```

### Performance Characteristics

✅ **Good Signs:**
- 240 "[TanStack DB Pooling]" messages in console
- Fast initial render (similar to Redux)
- Smooth tab switching
- Low CPU usage during updates

❌ **Bad Signs:**
- Many "Query not poolable" messages
- Slow initial render
- High CPU usage
- Laggy tab switching

## 🐛 Troubleshooting

### Issue: No Pooling Messages Appearing

**Possible causes:**
1. Build didn't include latest changes
   - Solution: Run `pnpm build` in root directory
2. test2-app is using npm packages instead of workspace
   - Solution: Check package.json uses `workspace:*` protocol

### Issue: Queries Falling Back to Standard Approach

**Check console for reason:**
- "Query has joins" → Not supported yet
- "Query has aggregations" → Not supported yet
- "Function X not supported for pooling" → Extend query analyzer

### Issue: Performance Not Improving

**Possible causes:**
1. Pooling is working but overhead elsewhere
   - Check React DevTools Profiler
2. Only partial pooling
   - Count how many queries are pooled vs standard

## 📈 Benchmark Comparison

### Original Performance (No Pooling)

| Environment | TanStack | Redux | Diff |
|-------------|----------|-------|------|
| Dev (normal) | 91ms | 48ms | +90% |
| Dev (4x throttle) | 364ms | 155ms | +135% |
| Prod (normal) | 54ms | 34ms | +58% |
| Prod (4x throttle) | 194ms | 63ms | +208% |

### Expected with Pooling

| Environment | Target | Notes |
|-------------|--------|-------|
| Dev (normal) | ~50-60ms | Competitive with Redux |
| Dev (4x throttle) | ~160-180ms | Much closer to Redux |
| Prod (normal) | ~35-45ms | Similar to Redux |
| Prod (4x throttle) | ~60-80ms | Close to Redux baseline |

## 🎯 Success Criteria

- ✅ 240 queries successfully pooled
- ✅ No fallback to standard approach
- ✅ Performance within 20% of Redux baseline
- ✅ Smooth tab switching with minimal re-renders
- ✅ Console shows shared subscription behavior

## 📝 Report Results

After testing, document:

1. **Pooling Detection**
   - Number of pooled queries: _____
   - Number of fallback queries: _____

2. **Performance Metrics**
   - Initial render (TanStack): _____ms
   - Initial render (Redux): _____ms
   - Tab switch (TanStack): _____ms
   - Tab switch (Redux): _____ms

3. **Issues Encountered**
   - List any problems: _____

4. **Overall Assessment**
   - Is pooling working: Yes / No
   - Performance improvement: ____%
   - Ready for production: Yes / No / Needs work
