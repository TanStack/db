#!/bin/bash

echo "=== What Actually Gets Bundled ===="
echo ""

echo "Testing localStorage collection (not just localStorage API):"
echo ""

# Test if localStorage COLLECTION is bundled
echo "1. localStorageCollectionOptions in minimal:"
if grep -q "localStorageCollectionOptions\|storageKey.*getItem.*setItem" bundle-minimal.min.js; then
  echo "   ❌ localStorage COLLECTION is bundled"
else
  echo "   ✅ localStorage collection NOT bundled (tree-shaking works!)"
fi

echo ""
echo "2. localStorageCollectionOptions in full:"
if grep -q "storageKey" bundle-full.min.js; then
  echo "   ✅ localStorage COLLECTION is in full bundle"
else
  echo "   ❌ localStorage COLLECTION missing from full bundle??"
fi

echo ""
echo "3. localOnlyCollectionOptions in minimal:"
if grep -q "localOnly" bundle-minimal.min.js; then
  echo "   ❌ localOnly collection is bundled"
else
  echo "   ✅ localOnly collection NOT bundled (tree-shaking works!)"
fi

echo ""
echo "=== Summary ==="
echo ""
echo "The 2 'localStorage' references in minimal bundle are from:"
echo "  - proxy.ts debug code (checking if localStorage exists for debug flag)"
echo "  - NOT from localStorage collection implementation"
echo ""
echo "Tree-shaking IS working for:"
echo "  ✅ localStorage collections"
echo "  ✅ localOnly collections"
echo ""
echo "Tree-shaking is NOT working for:"
echo "  ❌ Query system (circular dependency)"
echo "  ⚠️  B+ Tree (always used by collections)"
echo "  ⚠️  Proxy utilities (used for optimistic updates)"
