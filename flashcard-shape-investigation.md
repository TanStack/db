# Flashcard Shape Network Issue Investigation

## Issue Summary

**Reported Problem:** Users can see data in the database but are not seeing the expected data from shapes through the network tab.

**Investigation Date:** January 2026

**Repositories Analyzed:**
- TanStack db (`@tanstack/db`, `@tanstack/electric-db-collection`)
- Electric SQL (`@electric-sql/client`)

---

## Investigation Findings

After a thorough analysis of both the TanStack db codebase and the Electric SQL client library, **no bugs were found in either library** that would explain this issue. The issue appears to originate from the **proxy implementation** or a **data/configuration mismatch**.

---

## Potential Root Causes

### 1. UserID Format Mismatch (High Probability)

The proxy extracts `userId` from the JWT token and substitutes it into the WHERE clause:

```javascript
const userId = authResult.userId!
// ...
whereClause = whereClause.replace(/\$\d+/g, `'${userId}'`);
```

This creates a WHERE clause like: `student_id = 'abc-123-uuid'`

**Potential Issues:**

| Database `student_id` | JWT `userId` | Result |
|----------------------|--------------|--------|
| `abc-123-uuid` | `abc-123-uuid` | ✅ Match |
| `auth0\|abc123` | `abc123` | ❌ No match |
| `ABC-123-UUID` | `abc-123-uuid` | ❌ No match (case sensitive) |
| `abc-123-uuid` (UUID type) | `abc-123-uuid` (string) | ✅ Usually works |

**How to verify:**
1. Log the `userId` value in your proxy
2. Query the database directly: `SELECT DISTINCT student_id FROM flashcards LIMIT 5;`
3. Compare the formats

---

### 2. Column Name Case Sensitivity (Medium-High Probability)

PostgreSQL treats unquoted identifiers as lowercase. If your column was created with quotes:

```sql
-- This creates a case-sensitive column:
CREATE TABLE flashcards (
    "Student_Id" UUID,  -- Must be queried as "Student_Id"
    ...
);

-- This creates a lowercase column:
CREATE TABLE flashcards (
    student_id UUID,    -- Can be queried as student_id, Student_Id, STUDENT_ID
    ...
);
```

The shape WHERE clause uses `student_id` (lowercase). If the actual column is `"Student_Id"`, the query returns no results.

**Recent Fix in Electric SQL:**
- Commit `12ce210` (Jan 6, 2026): "Fix bug with case-sensitive column names in subqueries"
- This fix addresses subquery issues but the main shape WHERE clause might still be affected

**How to verify:**
```sql
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'flashcards';
```

---

### 3. Table Name or Schema Mismatch (Medium Probability)

The shape configuration uses:
```javascript
{
    id: 'flashcards',
    shape: {
        table: 'flashcards',  // Is this the correct table name?
        where: 'student_id = $1',
    },
}
```

**Potential Issues:**
- Table might be in a different schema: `public.flashcards` vs `app.flashcards`
- Table name might have different casing: `Flashcards` vs `flashcards`
- Table might not exist or have been renamed

**How to verify:**
```sql
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_name ILIKE '%flashcard%';
```

---

### 4. Empty WHERE Clause Results (High Probability)

Even if everything is configured correctly, the WHERE clause might return no results because:

1. **No data for this user:** The `student_id` filter correctly excludes all rows
2. **Data was deleted:** Rows existed before but were removed
3. **Data hasn't synced yet:** Rows were inserted but Electric hasn't processed them

**How to verify:**
```sql
-- Check if data exists for the user
SELECT COUNT(*) FROM flashcards WHERE student_id = '<your-user-id>';

-- Check when data was last modified
SELECT MAX(updated_at) FROM flashcards WHERE student_id = '<your-user-id>';
```

---

## Debugging Steps

### Step 1: Check Proxy Logs

Look for:
- JavaScript syntax errors
- Request/response logging
- Electric SQL error responses

### Step 2: Inspect Network Requests

In browser DevTools (Network tab):

1. **Find the shape request** to your proxy
2. **Check the request URL** - verify `shape_id=flashcards` is present
3. **Check the response:**
   - Status code (should be 200)
   - Response body (should be JSON array of operations)
   - Response headers (should have `electric-handle`, `electric-offset`)

**Example healthy response:**
```json
[
  {"headers":{"operation":"insert"},"key":"uuid-1","value":{"flashcard_id":"uuid-1","student_id":"user-123",...}},
  {"headers":{"control":"up-to-date"}}
]
```

**Example empty response (problem indicator):**
```json
[
  {"headers":{"control":"up-to-date"}}
]
```

### Step 3: Log the Constructed Electric URL

Add logging to your proxy:

```javascript
// After building the URL, log it:
console.log('Electric URL:', electricUrl.toString());
console.log('User ID:', userId);
console.log('Where clause:', whereClause);

// Expected output:
// Electric URL: https://api.electric-sql.cloud/v1/shape?table=flashcards&where=student_id%3D%27abc-123%27&source_id=...
// User ID: abc-123
// Where clause: student_id = 'abc-123'
```

### Step 4: Test Electric Directly

Bypass your proxy and test Electric SQL directly:

```bash
curl "https://api.electric-sql.cloud/v1/shape?table=flashcards&where=student_id%3D%27YOUR_USER_ID%27&source_id=YOUR_SOURCE_ID&secret=YOUR_SECRET"
```

If this returns data but your proxy doesn't, the issue is in the proxy.

### Step 5: Verify Database Data

```sql
-- Check the table exists and has data
SELECT COUNT(*) FROM flashcards;

-- Check data for a specific user
SELECT * FROM flashcards WHERE student_id = 'your-user-id' LIMIT 5;

-- Check column types
SELECT column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_name = 'flashcards';
```

---

## Code Review: Frontend Collection

The frontend collection configuration looks correct:

```javascript
createCollection<Flashcard>(
  electricCollectionOptions({
    id: "flashcards",
    getKey: (row) => row.flashcard_id,
    shapeOptions: {
      url: `${process.env.NEXT_PUBLIC_ELECTRIC_URL}/v1/shape`,
      params: {
        shape_id: 'flashcards'
      },
      headers: {
        Authorization: async () => { /* ... */ },
        userID: async () => { /* ... */ },
      },
      onError: async (error: Error) => { /* ... */ },
    },
    // ...
  })
);
```

**Notes:**
- `syncMode` is not specified, so it defaults to `eager` (full sync from beginning)
- The `onError` handler returns `{}` for retry, which is correct
- Headers are async functions, which is supported

---

## Code Review: Live Query

The live query includes a client-side filter:

```javascript
let query = q
  .from({ f: flashcardCollection })
  .where(({ f }) => eq((f as any).content_id, content_id))  // Client-side filter!
  .orderBy(({ f }) => (f as any).created_at, 'desc')
  .orderBy(({ f }) => (f as any).flashcard_id, 'asc')
  .select(({ f }) => ({ ...f }));
```

**Important:** This filters by `content_id` on the client side. Even if the shape syncs data, this query will return empty if:
- The `content_id` parameter doesn't match any flashcards
- The `content_id` field is null/undefined in the data

**How to verify:**
1. Check what `content_id` is being passed to `useFlashcardsLiveQuery`
2. Query without the filter to see if any data exists

---

## Electric SQL & TanStack DB Versions

Ensure you're using compatible versions:

**Minimum recommended versions:**
- `@electric-sql/client`: >= 1.3.1
- `@tanstack/db`: latest
- `@tanstack/electric-db-collection`: latest

**Recent relevant fixes in Electric SQL:**
| Commit | Date | Fix |
|--------|------|-----|
| `12ce210` | Jan 6, 2026 | Case-sensitive column names in subqueries |
| `9d27e85` | Jan 12, 2026 | Type casts on WHERE clause parameters |
| `6d6e199` | Jan 13, 2026 | Missing headers causing infinite loop |
| `41d11f4` | Jan 16, 2026 | Stale cached responses with expired handles |

---

## Recommended Fixes

### Fix 1: Add Proxy Debugging

```javascript
// Add comprehensive logging
console.log('[Electric Proxy] Request received:', {
    shapeId,
    userId,
    originalUrl: url.toString(),
});

// After building Electric URL
console.log('[Electric Proxy] Forwarding to Electric:', {
    electricUrl: electricUrl.toString(),
    whereClause,
    table: shapeConfig.shape.table,
});

// Log the response
const electricResponse = await fetch(electricUrl.toString(), { /* ... */ });
console.log('[Electric Proxy] Electric response:', {
    status: electricResponse.status,
    headers: Object.fromEntries(electricResponse.headers.entries()),
});
```

### Fix 2: Handle Case-Sensitive Columns

If your column is case-sensitive, update the shape configuration:

```javascript
{
    id: 'flashcards',
    shape: {
        table: 'flashcards',
        where: '"Student_Id" = $1',  // Use quotes for case-sensitive column
    },
}
```

### Fix 3: Verify User ID Format

```javascript
// In your proxy, validate the userId format:
const userId = authResult.userId!;

// Log for debugging
console.log('[Electric Proxy] User ID:', userId, 'Type:', typeof userId);

// If userId might have a prefix, handle it:
// const normalizedUserId = userId.replace('auth0|', '');
```

---

## Quick Diagnostic Checklist

- [ ] Proxy is deployed without syntax errors
- [ ] Proxy logs show requests being received
- [ ] Electric URL is constructed correctly (log it)
- [ ] `userId` matches the format in `student_id` column
- [ ] Table name matches exactly (including schema)
- [ ] Column name matches exactly (check case sensitivity)
- [ ] Data exists in the database for this user
- [ ] Network tab shows 200 response from proxy
- [ ] Response body contains data (not just control messages)
- [ ] No errors in browser console
- [ ] `content_id` parameter in live query matches existing data

---

## Validation Tests

Use these tests to verify each assertion and narrow down the root cause.

### Test 1: Verify TanStack DB and Electric SQL Are Working Correctly

Create a minimal test that bypasses your proxy to confirm the libraries work:

```typescript
// test-electric-direct.ts
import { ShapeStream } from '@electric-sql/client';

const stream = new ShapeStream({
  url: 'https://api.electric-sql.cloud/v1/shape',
  params: {
    table: 'flashcards',
    where: `student_id = 'YOUR_KNOWN_USER_ID'`,  // Use a real ID from your DB
    source_id: 'YOUR_SOURCE_ID',
    secret: 'YOUR_SECRET',
  },
});

stream.subscribe((messages) => {
  console.log('Messages received:', messages.length);
  messages.forEach((msg, i) => {
    console.log(`Message ${i}:`, JSON.stringify(msg, null, 2));
  });
});

// If this shows data, the issue is in your proxy
// If this shows empty, the issue is with the shape/data itself
```

### Test 2: Verify Proxy Constructs Correct URL

Add this temporary logging to your proxy:

```typescript
// In handleShapeRequest, after building electricUrl:

const debugInfo = {
  timestamp: new Date().toISOString(),
  shapeId,
  userId,
  table: shapeConfig.shape.table,
  originalWhere: shapeConfig.shape.where,
  constructedWhere: whereClause,
  fullElectricUrl: electricUrl.toString().replace(env.ELECTRIC_SECRET, '[REDACTED]'),
};

console.log('[PROXY DEBUG]', JSON.stringify(debugInfo, null, 2));

// Also log the response:
const electricResponse = await fetch(electricUrl.toString(), { /* ... */ });

// Clone response to read body without consuming it
const responseClone = electricResponse.clone();
const responseBody = await responseClone.text();
console.log('[PROXY DEBUG] Response status:', electricResponse.status);
console.log('[PROXY DEBUG] Response body preview:', responseBody.substring(0, 500));
```

**Expected output if working:**
```json
{
  "timestamp": "2026-01-20T...",
  "shapeId": "flashcards",
  "userId": "abc-123-uuid",
  "table": "flashcards",
  "originalWhere": "student_id = $1",
  "constructedWhere": "student_id = 'abc-123-uuid'",
  "fullElectricUrl": "https://api.electric-sql.cloud/v1/shape?table=flashcards&where=student_id%20%3D%20%27abc-123-uuid%27..."
}
```

### Test 3: Verify Database Data Exists

Run these queries directly against your database:

```sql
-- 1. Confirm table exists and check column names
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'flashcards'
ORDER BY ordinal_position;

-- Expected: Should show student_id column with UUID or TEXT type

-- 2. Check total row count
SELECT COUNT(*) as total_rows FROM flashcards;

-- Expected: Should be > 0

-- 3. Get sample of student_id values to compare format
SELECT DISTINCT student_id, pg_typeof(student_id) as data_type
FROM flashcards
LIMIT 10;

-- Expected: Shows the actual format of student_id values

-- 4. Check if specific user has data (replace with actual userId from JWT)
SELECT COUNT(*) as user_rows
FROM flashcards
WHERE student_id = 'YOUR_JWT_USER_ID';

-- Expected: Should be > 0 if user has flashcards

-- 5. If above returns 0, check for similar IDs (find format mismatch)
SELECT DISTINCT student_id
FROM flashcards
WHERE student_id::text ILIKE '%' || 'PARTIAL_USER_ID' || '%'
LIMIT 10;
```

### Test 4: Verify JWT Contains Correct User ID

Add logging to your authentication function:

```typescript
// In authenticateRequest or after it returns:
console.log('[AUTH DEBUG] Full JWT payload:', JSON.stringify(authResult, null, 2));
console.log('[AUTH DEBUG] Extracted userId:', authResult.userId);
console.log('[AUTH DEBUG] userId type:', typeof authResult.userId);

// Compare with database format:
// If JWT userId is "abc123" but DB has "auth0|abc123", you found the mismatch
```

### Test 5: Verify Frontend Receives Data (Independent of Query Filter)

Temporarily modify your live query to remove the `content_id` filter:

```typescript
// Temporary test version - remove content_id filter
export const useFlashcardsLiveQueryDEBUG = () => {
  const result = useLiveQuery(
    (q) => {
      if (!flashcardCollection) {
        throw new Error('Flashcard collection not initialized');
      }

      // NO FILTER - get all flashcards for this user
      let query = q
        .from({ f: flashcardCollection })
        .select(({ f }) => ({ ...f }));

      return query;
    },
    []  // No dependencies
  );

  // Log the result
  console.log('[QUERY DEBUG] isLoading:', result?.isLoading);
  console.log('[QUERY DEBUG] data count:', result?.data?.length);
  console.log('[QUERY DEBUG] first item:', result?.data?.[0]);

  return result;
};
```

If this shows data but the original query doesn't, the issue is with the `content_id` filter.

### Test 6: Verify Electric Shape Stream State

Add debugging to your collection initialization:

```typescript
// Temporarily add debugging to your collection
const createFlashcardCollectionDEBUG = () => {
  const collection = createCollection<Flashcard>(
    electricCollectionOptions({
      id: "flashcards-debug",
      getKey: (row) => row.flashcard_id,
      shapeOptions: {
        url: `${process.env.NEXT_PUBLIC_ELECTRIC_URL}/v1/shape`,
        params: {
          shape_id: 'flashcards'
        },
        headers: {
          Authorization: async () => {
            const { data } = await browserSupabaseClient.auth.getSession();
            console.log('[SHAPE DEBUG] Getting auth token...');
            return `Bearer ${data.session?.access_token}`;
          },
          userID: async () => {
            const { data } = await browserSupabaseClient.auth.getSession();
            const userId = data.session?.user?.id || '';
            console.log('[SHAPE DEBUG] UserID for header:', userId);
            return userId;
          },
        },
        onError: async (error: Error) => {
          console.error('[SHAPE DEBUG] Error:', error.message);
          console.error('[SHAPE DEBUG] Full error:', error);
          return {};
        },
      },
      onInsert: async (params) => {
        console.log('[SHAPE DEBUG] onInsert called:', params);
        // ... rest of handler
      },
    })
  );

  return collection;
};
```

### Test 7: Verify Network Request/Response

In browser DevTools, use this to capture and analyze the shape request:

```javascript
// Run in browser console before triggering the shape request:

const originalFetch = window.fetch;
window.fetch = async (...args) => {
  const [url, options] = args;

  // Only log shape requests
  if (url.toString().includes('/v1/shape')) {
    console.log('[FETCH DEBUG] Shape request URL:', url);
    console.log('[FETCH DEBUG] Request options:', options);
  }

  const response = await originalFetch(...args);

  if (url.toString().includes('/v1/shape')) {
    // Clone to read body without consuming
    const clone = response.clone();
    const body = await clone.text();

    console.log('[FETCH DEBUG] Response status:', response.status);
    console.log('[FETCH DEBUG] Response headers:', Object.fromEntries(response.headers.entries()));
    console.log('[FETCH DEBUG] Response body:', body.substring(0, 1000));

    // Parse and analyze
    try {
      const parsed = JSON.parse(body);
      const dataMessages = parsed.filter(m => m.value);
      const controlMessages = parsed.filter(m => m.headers?.control);
      console.log('[FETCH DEBUG] Data messages:', dataMessages.length);
      console.log('[FETCH DEBUG] Control messages:', controlMessages.map(m => m.headers.control));
    } catch (e) {
      console.log('[FETCH DEBUG] Body is not JSON');
    }
  }

  return response;
};

console.log('Fetch interception enabled - trigger your shape request now');
```

### Test 8: Direct cURL Test

Test your proxy directly from command line:

```bash
# 1. Get a valid auth token (from browser DevTools > Application > Local Storage or Network tab)
TOKEN="your_jwt_token_here"

# 2. Test your proxy
curl -v "https://your-proxy-url/v1/shape?shape_id=flashcards" \
  -H "Authorization: Bearer $TOKEN" \
  -H "userID: your-user-id" \
  2>&1 | head -100

# Expected: Should return JSON array with flashcard data

# 3. If proxy returns empty, test Electric directly (with your credentials)
curl -v "https://api.electric-sql.cloud/v1/shape?table=flashcards&where=student_id%3D%27YOUR_USER_ID%27&source_id=YOUR_ID&secret=YOUR_SECRET" \
  2>&1 | head -100
```

---

## Expected Results Summary

| Test | If Working | If Broken |
|------|-----------|-----------|
| Test 1 (Direct Electric) | Shows flashcard data | Empty or error |
| Test 2 (Proxy URL) | Correct WHERE clause | Malformed URL or wrong ID |
| Test 3 (DB Query) | Rows exist for user | 0 rows or format mismatch |
| Test 4 (JWT Debug) | userId matches DB format | Format differs from DB |
| Test 5 (No Filter Query) | Shows all user flashcards | Empty (shape issue) |
| Test 6 (Collection Debug) | onInsert called with data | Only errors logged |
| Test 7 (Network Capture) | Data messages in response | Only control messages |
| Test 8 (cURL) | JSON array with values | Empty array or error |

---

## Contact & Support

If the issue persists after checking all the above:

1. **Capture the full request/response** from the network tab
2. **Get the proxy logs** for the failing request
3. **Query the database** to confirm data exists for the user
4. **Share the Electric URL** that the proxy constructs (redact secrets)

This information will help narrow down whether the issue is in:
- The proxy configuration
- The Electric SQL service
- The database data
- The frontend collection/query
