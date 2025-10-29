#!/bin/bash

echo "=== Analyzing Import Dependencies ==="
echo ""

# Check what collection/index.js imports
echo "1. What does collection/index.js import?"
grep "^import" packages/db/dist/esm/collection/index.js | head -10

echo ""
echo "2. What does local-storage.js import?"  
grep "^import" packages/db/dist/esm/local-storage.js | head -10

echo ""
echo "3. What does query/builder/index.js import?"
grep "^import" packages/db/dist/esm/query/builder/index.js | head -10

echo ""
echo "4. Check if there are circular dependencies or cross-imports..."
echo "Does collection import query system?"
grep -r "query" packages/db/dist/esm/collection/*.js | grep "import" | head -5 || echo "  No"

echo ""
echo "Does query import collection?"
grep "collection" packages/db/dist/esm/query/builder/index.js | grep "import" | head -5 || echo "  No"
