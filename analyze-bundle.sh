#!/bin/bash

echo "=== What's in bundle-minimal.js? ==="
echo ""

echo "Checking for major components:"
echo ""

echo -n "Query System (BaseQueryBuilder): "
grep -q "BaseQueryBuilder" bundle-minimal.js && echo "✓ INCLUDED" || echo "✗ Not included"

echo -n "Query Optimizer: "
grep -q "optimizeQuery\|predicate pushdown" bundle-minimal.js && echo "✓ INCLUDED" || echo "✗ Not included"

echo -n "Query Compiler: "
grep -q "compileQuery\|compileJoins" bundle-minimal.js && echo "✓ INCLUDED" || echo "✗ Not included"

echo -n "localStorage: "
grep -q "localStorageCollectionOptions\|localStorage" bundle-minimal.js && echo "✓ INCLUDED" || echo "✗ Not included"

echo -n "Live Queries: "
grep -q "createLiveQueryCollection\|liveQueryCollectionOptions" bundle-minimal.js && echo "✓ INCLUDED" || echo "✗ Not included"

echo -n "B+ Tree: "
grep -q "BTree\|btree" bundle-minimal.js && echo "✓ INCLUDED" || echo "✗ Not included"

echo -n "Proxy utilities: "
grep -q "createChangeProxy\|withChangeTracking" bundle-minimal.js && echo "✓ INCLUDED" || echo "✗ Not included"

echo ""
echo "Error classes found:"
grep -o "Error extends" bundle-minimal.js | wc -l | xargs echo "  Count:"

echo ""
echo "Query-related imports:"
grep -c "query/builder\|query/compiler\|query/optimizer" bundle-minimal.js | xargs echo "  References:"
