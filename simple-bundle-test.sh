#!/bin/bash

# Test 1: Minimal import
echo "// Minimal import" > test-min.js
echo "import { createCollection } from './packages/db/dist/esm/index.js'" >> test-min.js
echo "console.log(createCollection)" >> test-min.js

npx esbuild --bundle test-min.js --format=esm --outfile=test-min-bundle.js --external:@tanstack/db-ivm 2>/dev/null

MIN_SIZE=$(wc -c < test-min-bundle.js)
MIN_LINES=$(wc -l < test-min-bundle.js)

# Test 2: Full import
echo "// Full import" > test-full.js
echo "import { createCollection, Query, localStorageCollectionOptions } from './packages/db/dist/esm/index.js'" >> test-full.js
echo "console.log(createCollection, Query, localStorageCollectionOptions)" >> test-full.js

npx esbuild --bundle test-full.js --format=esm --outfile=test-full-bundle.js --external:@tanstack/db-ivm 2>/dev/null

FULL_SIZE=$(wc -c < test-full-bundle.js)
FULL_LINES=$(wc -l < test-full-bundle.js)

echo "=== Tree-Shaking Test Results ==="
echo ""
echo "Minimal import (just createCollection):"
echo "  Size: $((MIN_SIZE / 1024)) KB ($MIN_SIZE bytes)"
echo "  Lines: $MIN_LINES"
echo ""
echo "Full import (createCollection + Query + localStorage):"
echo "  Size: $((FULL_SIZE / 1024)) KB ($FULL_SIZE bytes)"
echo "  Lines: $FULL_LINES"
echo ""
echo "Difference: $((FULL_SIZE - MIN_SIZE)) bytes ($((FULL_SIZE * 100 / MIN_SIZE - 100))% larger)"
echo ""
if [ $MIN_SIZE -lt $((FULL_SIZE / 2)) ]; then
  echo "✅ Tree-shaking appears to be working! Minimal bundle is significantly smaller."
else
  echo "❌ Tree-shaking NOT effective! Both bundles are similar size."
fi
