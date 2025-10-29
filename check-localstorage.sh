#!/bin/bash

echo "=== Checking if localStorage is in minimal bundle ==="
echo ""

echo "Searching for localStorage-specific code..."
echo ""

# Check minified bundle
echo "1. localStorage references:"
grep -o "localStorage" bundle-minimal.min.js | wc -l | xargs echo "   Count in minimal bundle:"

echo ""
echo "2. Storage-specific error classes:"
grep -o "StorageKeyRequiredError\|InvalidStorageDataFormat\|SerializationError" bundle-minimal.min.js | wc -l | xargs echo "   Count:"

echo ""
echo "3. localStorageCollectionOptions function:"
grep -c "localStorageCollectionOptions" bundle-minimal.min.js | xargs echo "   Found:"

echo ""
echo "4. Local-only collection options:"
grep -c "localOnlyCollectionOptions" bundle-minimal.min.js | xargs echo "   Found:"

echo ""
echo "5. Searching unminified for more context..."
grep -c "local-storage.js" bundle-minimal.js | xargs echo "   Import references in unminified:"

echo ""
echo "6. Check what's actually in the bundle:"
if grep -q "storageKey.*getItem.*setItem" bundle-minimal.min.js; then
  echo "   ❌ localStorage implementation IS bundled"
else
  echo "   ✅ localStorage implementation NOT bundled"
fi

echo ""
echo "7. Size estimate of localStorage code:"
# Extract just the localStorage module from source
LOCAL_STORAGE_SIZE=$(wc -c < packages/db/dist/esm/local-storage.js)
echo "   Source file: $((LOCAL_STORAGE_SIZE / 1024)) KB unminified"

echo ""
echo "=== Detailed search in minified bundle ==="
echo "Looking for localStorage API usage patterns..."
if grep -q "getItem\|setItem\|removeItem" bundle-minimal.min.js | head -3; then
  echo "Storage API methods found - checking context..."
  grep -o ".{0,50}getItem.{0,50}" bundle-minimal.min.js | head -3
fi
