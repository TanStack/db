# Schema Documentation Plan - v2 (Refined After Investigation)

## Investigation Summary

### What's Currently Documented

**1. overview.md (lines 144-154)**
- ✅ Mentions schemas are optional but recommended
- ✅ Lists supported schema libraries (Zod, Effect)
- ✅ Says schemas do "client-side validation"
- ❌ No explanation of TInput/TOutput
- ❌ No transformation examples
- ❌ No mention of data flow

**2. mutations.md (lines 495-560)**
- ✅ Shows Zod for **action parameter validation**
- ❌ Does NOT cover TInput/TOutput for collection data
- ❌ Does NOT show schema transformations

**3. error-handling.md (lines 25-46)**
- ✅ Shows SchemaValidationError basics
- ✅ Shows error properties (type, issues, message)
- ❌ No explanation of when/why validation happens
- ❌ No transformation examples

**4. live-queries.md**
- ✅ Mentions schema is optional for createLiveQueryCollection (line 95)
- ❌ No explanation of schema behavior
- ❌ Only says "result types are automatically inferred"

**5. collection-options-creator.md (lines 174-220)**
- ✅ Has section on "Data Parsing and Type Conversion"
- ✅ Shows integration-specific `parse`/`serialize` functions
- ❌ This is DIFFERENT from schema validation
- ❌ Doesn't explain the relationship between the two

### Key Finding: Two Distinct Mechanisms

From examples and codebase, there are **TWO separate type conversion mechanisms**:

1. **Integration-Level Parsing** (e.g., TrailBase's `parse/serialize`, Electric's `parser`)
   - Purpose: Convert between storage format and in-memory format
   - Layer: Sync layer (happens during `write()`)
   - Example: Unix timestamp → Date, WKB → GeoJSON
   - Used by: Integration authors

2. **Schema Validation/Transformation** (the `schema` property)
   - Purpose: Validate user input and transform TInput → TOutput
   - Layer: Mutation layer (happens during `insert()`/`update()`)
   - Example: ISO string → Date, applying defaults, validation
   - Used by: App developers

**These are complementary but serve different purposes!**

---

## Proposed Documentation Strategy

### Phase 1: Create New Comprehensive Guide

**File:** `docs/guides/schemas.md`

**Why a new guide?**
- Schemas affect mutations, queries, sync, AND error handling
- Content is substantial (~1500 lines with examples)
- Needs to serve both app developers AND integration authors
- Deserves prominent discoverability

**Target Audiences:**
1. **App Developers** (80% of content)
   - Understanding TInput/TOutput
   - Using transformations
   - Handling updates
   - Error handling
   - Best practices

2. **Integration Authors** (20% of content)
   - How schemas interact with sync
   - When to use integration parsing vs schemas
   - Calling `validateData()` correctly
   - Handling serialization

---

### Phase 2: Update Existing Docs

#### 2.1 Update `overview.md` (lines 144-154)

**Current:**
```markdown
#### Collection schemas

All collections optionally (though strongly recommended) support adding a `schema`.

If provided, this must be a [Standard Schema](https://standardschema.dev) compatible schema instance, such as a [Zod](https://zod.dev) or [Effect](https://effect.website/docs/schema/introduction/) schema.

The collection will use the schema to do client-side validation of optimistic mutations.
```

**Replace with:**
```markdown
#### Collection schemas

All collections optionally (though strongly recommended) support adding a `schema`.

If provided, this must be a [Standard Schema](https://standardschema.dev) compatible schema instance, such as [Zod](https://zod.dev), [Valibot](https://valibot.dev), [ArkType](https://arktype.io), or [Effect](https://effect.website/docs/schema/introduction/).

**What schemas do:**

1. **Runtime validation** - Ensures data meets your constraints before entering the collection
2. **Type transformations** - Convert input types to rich output types (e.g., string → Date)
3. **Default values** - Automatically populate missing fields
4. **Type safety** - Infer TypeScript types from your schema

**Example:**
```typescript
const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean().default(false),
  created_at: z.string().transform(val => new Date(val)),  // string → Date
  priority: z.number().default(0)
})

const collection = createCollection(
  queryCollectionOptions({
    schema: todoSchema,
    // ...
  })
)

// Users provide simple inputs
collection.insert({
  id: "1",
  text: "Buy groceries",
  created_at: "2024-01-01T00:00:00Z"  // string
  // completed and priority filled automatically
})

// Collection stores and returns rich types
const todo = collection.get("1")
console.log(todo.created_at.getFullYear())  // It's a Date!
console.log(todo.completed)  // false (default)
```

The collection will use the schema for its type inference. If you provide a schema, you cannot also pass an explicit type parameter (e.g., `createCollection<Todo>()`).

**Learn more:** See the [Schemas guide](../guides/schemas.md) for comprehensive documentation on schema validation, type transformations, and best practices.
```

#### 2.2 Add to `mutations.md` (after Operation Handlers section, ~line 394)

Add a new section:

```markdown
### Schema Validation in Mutation Handlers

When a schema is configured, TanStack DB automatically validates and transforms data during mutations. The mutation handlers receive the **transformed data** (TOutput), not the raw input.

```typescript
const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  created_at: z.string().transform(val => new Date(val))  // TInput: string, TOutput: Date
})

const collection = createCollection({
  schema: todoSchema,
  onInsert: async ({ transaction }) => {
    const item = transaction.mutations[0].modified

    // item.created_at is already a Date object (TOutput)
    console.log(item.created_at instanceof Date)  // true

    // If your API needs a string, serialize it
    await api.todos.create({
      ...item,
      created_at: item.created_at.toISOString()  // Date → string
    })
  }
})

// User provides string (TInput)
collection.insert({
  id: "1",
  text: "Task",
  created_at: "2024-01-01T00:00:00Z"
})
```

**Key points:**
- Schema validation happens **before** mutation handlers are called
- Handlers receive **TOutput** (transformed data)
- If your backend needs a different format, serialize in the handler
- Schema validation errors throw `SchemaValidationError` before handlers run

For comprehensive documentation on schema validation and transformations, see the [Schemas guide](./schemas.md).
```

#### 2.3 Update `error-handling.md` (lines 25-46)

**Current section is good but add after line 46:**

```markdown
**When schema validation occurs:**

Schema validation happens at the **collection boundary** when data enters or is modified:

1. **During inserts** - When `collection.insert()` is called
2. **During updates** - When `collection.update()` is called
3. **During sync writes** - When integration calls `collection.validateData()`

The schema transforms **TInput** (user-provided data) into **TOutput** (stored data):

```typescript
const schema = z.object({
  created_at: z.string().transform(val => new Date(val))
  // TInput: string, TOutput: Date
})

// Validation happens here ↓
collection.insert({
  created_at: "2024-01-01"  // TInput: string
})
// If successful, stores: { created_at: Date }  // TOutput: Date
```

For more details on schema validation and type transformations, see the [Schemas guide](./schemas.md).
```

#### 2.4 Update `collection-options-creator.md` (after line 220)

**Add a new section after "Data Parsing and Type Conversion":**

```markdown
### Integration Parsing vs Schema Validation

Integration authors need to understand the **two distinct type conversion mechanisms**:

#### 1. Integration-Level Parsing (`parse`/`serialize` or `parser`)

This is **your responsibility** as an integration author. It converts between storage format and in-memory format.

```typescript
// Example: TrailBase stores timestamps as Unix seconds
export function trailbaseCollectionOptions<TItem, TRecord>(config) {
  return {
    parse: {
      created_at: (ts: number) => new Date(ts * 1000)  // Unix timestamp → Date
    },
    serialize: {
      created_at: (date: Date) => Math.floor(date.valueOf() / 1000)  // Date → Unix timestamp
    },
    // This happens during sync write()
  }
}
```

**When to use:** When your storage layer uses different types than TanStack DB (e.g., Unix timestamps, WKB geometry, JSON strings).

**Where it happens:** In the sync layer, during `write()` operations.

#### 2. Schema Validation (the `schema` property)

This is **the user's choice**. They can optionally provide a schema that validates and transforms data during mutations.

```typescript
// User-defined schema
const todoSchema = z.object({
  id: z.string(),
  created_at: z.string().transform(val => new Date(val))  // string → Date
})

const collection = createCollection(
  myCollectionOptions({
    schema: todoSchema,  // User provides this
    // ...
  })
)
```

**When to use (for users):** For input validation, transformations, and defaults during mutations.

**Where it happens:** At the mutation layer, during `insert()`/`update()`.

#### How They Work Together

```typescript
// 1. User calls insert with TInput
collection.insert({
  id: "1",
  created_at: "2024-01-01T00:00:00Z"  // string
})

// 2. Schema validates/transforms: string → Date (if schema is provided)
// Result: { id: "1", created_at: Date }  // TOutput

// 3. Your onInsert handler receives TOutput
onInsert: async ({ transaction }) => {
  const item = transaction.mutations[0].modified  // { created_at: Date }

  // 4. Serialize for your storage layer
  const storageFormat = {
    ...item,
    created_at: Math.floor(item.created_at.valueOf() / 1000)  // Date → Unix timestamp
  }

  // 5. Write to storage
  await storage.write(storageFormat)
}

// 6. When syncing back FROM storage:
sync: ({ write, collection }) => {
  const storageRow = { id: "1", created_at: 1704067200 }  // Unix timestamp

  // 7. Parse from storage format
  const parsed = {
    ...storageRow,
    created_at: new Date(storageRow.created_at * 1000)  // Unix → Date
  }

  // 8. Optionally validate with schema
  const validated = collection.validateData(parsed, 'insert')

  // 9. Write to collection as TOutput
  write({ type: 'insert', value: validated })
}
```

#### Best Practices for Integration Authors

1. **Always call `collection.validateData()`** when syncing data INTO the collection
2. **Serialize in mutation handlers** when persisting data FROM the collection
3. **Don't constrain user schemas** - let users define rich TOutput types
4. **Document your parsing requirements** - explain what formats your storage uses
5. **Provide good TypeScript types** - use generics to support user schemas

**Example: Calling validateData() during sync**

```typescript
export function myCollectionOptions(config) {
  return {
    sync: {
      sync: ({ write, begin, commit, collection }) => {
        // Read from your storage
        const storageData = await fetchFromStorage()

        begin()
        for (const row of storageData) {
          // Parse from storage format
          const parsed = parseFromStorageFormat(row)

          // Validate and transform using user's schema (if provided)
          const validated = collection.validateData(parsed, 'insert')

          // Write TOutput to collection
          write({ type: 'insert', value: validated })
        }
        commit()
      }
    },

    onInsert: async ({ transaction }) => {
      const items = transaction.mutations.map(m => m.modified)  // TOutput

      // Serialize for your storage
      const serialized = items.map(item => serializeForStorage(item))

      // Write to storage
      await storage.bulkWrite(serialized)
    }
  }
}
```

For comprehensive documentation on schemas from a user perspective, see the [Schemas guide](./schemas.md).
```

---

### Phase 3: Create the New Schemas Guide

**File:** `docs/guides/schemas.md`

**Structure (detailed outline):**

#### 1. Introduction (5 min read)
- What schemas do in TanStack DB
- Why use them (type safety, validation, transformations)
- StandardSchema compatibility

#### 2. Core Concepts: TInput vs TOutput (5 min)
- Clear explanation with diagrams
- Data flow through the system
- Where validation happens

```typescript
const schema = z.object({
  created_at: z.string().transform(val => new Date(val))
  // TInput: string (what users provide)
  // TOutput: Date (what's stored and returned)
})
```

#### 3. Data Flow Diagram
Visual showing the journey from user input → validation → storage → queries

```
User Input (TInput)
      ↓
collection.insert()
      ↓
Schema Validation & Transformation
      ↓
Collection Storage (TOutput)
      ↓
Queries & Reads (TOutput)
```

#### 4. Transformation Examples (10 min)

**4.1 Type Conversions**
- String → Date
- Number → Enum
- JSON string → Object
- Computed fields

**4.2 Default Values**
- `.default()` with literals
- `.default()` with functions
- Arrays and objects

**4.3 Validation & Constraints**
- `.min()`, `.max()`, `.email()`, etc.
- Custom validation
- Error messages

#### 5. Handling Updates (10 min)

**The Challenge:** Existing data is TOutput, but users provide TInput

**Solution:** Union types

```typescript
const schema = z.object({
  created_at: z.union([
    z.string(),  // New input
    z.date()     // Existing data
  ]).transform(val => typeof val === 'string' ? new Date(val) : val)
})
```

#### 6. For App Developers (15 min)

**6.1 When to Use Schemas**
- Always recommended
- Benefits list

**6.2 Common Patterns**
- Date handling (with and without unions)
- Timestamps with defaults
- Type-safe enums
- Nullable/optional fields
- Arrays with defaults

**6.3 Best Practices**
- Prefer rich TOutput types
- Use unions for updates
- Keep transformations simple
- Consider performance

**6.4 Complete Example**
Full working todo app with schema

#### 7. For Integration Authors (10 min)

**7.1 Understanding the Boundary**
- Schema validation vs integration parsing
- When each happens
- How they work together

**7.2 Calling validateData()**
```typescript
// When syncing TO collection
const validated = collection.validateData(row, 'insert')
write({ type: 'insert', value: validated })
```

**7.3 Serializing in Handlers**
```typescript
// When persisting FROM collection
onInsert: async ({ transaction }) => {
  const item = transaction.mutations[0].modified  // TOutput
  const serialized = serializeForStorage(item)
  await storage.write(serialized)
}
```

**7.4 Best Practices**
- Always call validateData() during sync
- Don't constrain user schemas to storage types
- Handle validation errors gracefully

#### 8. Error Handling (5 min)
- SchemaValidationError structure
- Catching and displaying errors
- Handling invalid sync data

#### 9. Performance Considerations (3 min)
- When validation happens
- Cost of complex transformations
- Optimization tips

#### 10. Complete Working Examples (10 min)
- Todo app with rich types
- E-commerce product with computed fields
- Multi-collection transaction

#### 11. Related Topics
- Links to mutations.md, error-handling.md, collection-options-creator.md
- Link to StandardSchema spec

---

## Implementation Order

1. ✅ **Create schemas.md** (the comprehensive guide)
2. ✅ **Update overview.md** (expand collection schemas section, add example)
3. ✅ **Update mutations.md** (add schema validation section)
4. ✅ **Update error-handling.md** (add "when schema validation occurs")
5. ✅ **Update collection-options-creator.md** (add "Integration Parsing vs Schema Validation" section)
6. ⏭️ **Update navigation** (add schemas.md to docs navigation/sidebar)
7. ⏭️ **Review examples** (ensure they follow best practices)
8. ⏭️ **Get feedback** (from integration authors and community)

---

## Success Criteria

After implementation, developers should be able to:

### App Developers
1. ✅ Explain TInput vs TOutput
2. ✅ Use `.transform()` to convert types
3. ✅ Apply default values with `.default()`
4. ✅ Handle both new input and existing data in update schemas
5. ✅ Understand when schema validation happens
6. ✅ Debug SchemaValidationError

### Integration Authors
7. ✅ Distinguish between integration parsing and schema validation
8. ✅ Know when to call `collection.validateData()`
9. ✅ Understand where to serialize/deserialize
10. ✅ Avoid constraining user schemas to storage types

---

## Key Insights from Investigation

1. **Two Mechanisms Exist:** Integration parsing (storage format) and schema validation (user input) serve different purposes

2. **Real-World Usage:** Examples show:
   - Union types for handling both string and Date
   - Integration-specific parsing (Electric `parser`, TrailBase `parse/serialize`)
   - Schemas for validation and defaults

3. **Current Gap:** No documentation explains:
   - TInput vs TOutput concept
   - How the two mechanisms relate
   - When to use which approach
   - Best practices for either audience

4. **Documentation Spread:** Schema-related content currently in 4 docs but none comprehensive

5. **PowerSync Confusion:** Their question proves the need - they didn't understand:
   - TOutput should be rich types
   - Integration layer handles serialization
   - Schema validation vs sync parsing

---

## Next Steps

1. Get approval on this refined plan
2. Implement schemas.md with full content
3. Make targeted updates to existing docs
4. Add navigation links
5. Review with integration authors (Electric, PowerSync, TrailBase teams)
6. Collect feedback and iterate

This approach provides:
- ✅ Comprehensive coverage in one place (schemas.md)
- ✅ Targeted updates to existing docs (not overwhelming)
- ✅ Clear distinction between app dev and integration author concerns
- ✅ Addresses PowerSync-type confusion directly
- ✅ Builds on existing example patterns
