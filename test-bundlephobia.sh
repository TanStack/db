#!/bin/bash

echo "=== Testing What Bundlephobia Measures ==="
echo ""

echo "1. Building with ALL dependencies included (no externals)..."
npx esbuild test-everything.js --bundle --format=esm --minify --outfile=bundle-with-deps.min.js 2>&1 | grep -E "bundle-with-deps|Done"

echo ""
echo "2. Calculating sizes..."
MIN_SIZE=$(wc -c < bundle-minimal.min.js)
FULL_SIZE=$(wc -c < bundle-everything.min.js)
DEPS_SIZE=$(wc -c < bundle-with-deps.min.js)

MIN_GZIP=$(gzip -c bundle-minimal.min.js | wc -c)
FULL_GZIP=$(gzip -c bundle-everything.min.js | wc -c)
DEPS_GZIP=$(gzip -c bundle-with-deps.min.js | wc -c)

echo ""
echo "=== Results ==="
echo ""
printf "%-50s %12s %12s\n" "Bundle Type" "Minified" "Gzipped"
printf "%-50s %12s %12s\n" "-----------" "--------" "-------"
printf "%-50s %9.1f KB %9.1f KB\n" "Minimal (createCollection only)" "$(echo "scale=1; $MIN_SIZE/1024" | bc)" "$(echo "scale=1; $MIN_GZIP/1024" | bc)"
printf "%-50s %9.1f KB %9.1f KB\n" "Everything (all exports, deps external)" "$(echo "scale=1; $FULL_SIZE/1024" | bc)" "$(echo "scale=1; $FULL_GZIP/1024" | bc)"
printf "%-50s %9.1f KB %9.1f KB\n" "Everything + dependencies (like bundlephobia)" "$(echo "scale=1; $DEPS_SIZE/1024" | bc)" "$(echo "scale=1; $DEPS_GZIP/1024" | bc)"

echo ""
echo "Bundlephobia reports: 40.5 KB minified + gzipped"
echo ""

if [ "$DEPS_GZIP" -gt 40000 ]; then
  echo "✅ My test matches bundlephobia (~40 KB)"
else
  echo "⚠️  Still doesn't match. Checking what's different..."
fi

echo ""
echo "What is @tanstack/db-ivm?"
ls -lh packages/db-ivm/dist/esm/ 2>/dev/null | head -5 || echo "  (not built yet)"
