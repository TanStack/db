---
"@tanstack/powersync-db-collection": patch
---

Added support for tracking collection operation metadata in PowerSync CrudEntry operations.

```typescript
// Schema config
const APP_SCHEMA = new Schema({
  documents: new Table(
    {
      name: column.text,
      author: column.text,
      created_at: column.text,
    },
    {
      // Metadata tracking must be enabled on the PowerSync table
      trackMetadata: true,
    }
  ),
})

// ... Other config

// Collection operations which specify metadata
await collection.insert(
  {
    id,
    name: `document`,
    author: `Foo`,
  },
  // The string version of this will be present in PowerSync `CrudEntry`s during uploads
  {
    metadata: {
      extraInfo: "Info",
    },
  }
)
```
