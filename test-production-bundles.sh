#!/bin/bash

echo "=== Production Build Test (Minified + Gzipped) ==="
echo ""

# Build minified bundles
echo "Building minified bundles..."
npx esbuild test-minimal.js --bundle --format=esm --minify --outfile=bundle-minimal.min.js --external:@tanstack/db-ivm 2>&1 | grep -E "bundle-minimal|Done"
npx esbuild test-query.js --bundle --format=esm --minify --outfile=bundle-query.min.js --external:@tanstack/db-ivm 2>&1 | grep -E "bundle-query|Done"
npx esbuild test-full.js --bundle --format=esm --minify --outfile=bundle-full.min.js --external:@tanstack/db-ivm 2>&1 | grep -E "bundle-full|Done"

echo ""
echo "Results:"
echo ""

# Calculate sizes
MIN_SIZE=$(wc -c < bundle-minimal.min.js)
MIN_GZIP=$(gzip -c bundle-minimal.min.js | wc -c)

QUERY_SIZE=$(wc -c < bundle-query.min.js)
QUERY_GZIP=$(gzip -c bundle-query.min.js | wc -c)

FULL_SIZE=$(wc -c < bundle-full.min.js)
FULL_GZIP=$(gzip -c bundle-full.min.js | wc -c)

# Display table
printf "%-45s %12s %12s\n" "Import Pattern" "Minified" "Gzipped"
printf "%-45s %12s %12s\n" "---------------" "--------" "-------"
printf "%-45s %9.1f KB %9.1f KB\n" "import { createCollection }" "$(echo "scale=1; $MIN_SIZE/1024" | bc)" "$(echo "scale=1; $MIN_GZIP/1024" | bc)"
printf "%-45s %9.1f KB %9.1f KB\n" "import { createCollection, Query }" "$(echo "scale=1; $QUERY_SIZE/1024" | bc)" "$(echo "scale=1; $QUERY_GZIP/1024" | bc)"
printf "%-45s %9.1f KB %9.1f KB\n" "import { ...all features }" "$(echo "scale=1; $FULL_SIZE/1024" | bc)" "$(echo "scale=1; $FULL_GZIP/1024" | bc)"

echo ""
echo "Comparison vs unminified:"
UNMIN_SIZE=$(wc -c < bundle-minimal.js)
echo "  Minimal: $(wc -c < bundle-minimal.js) → $MIN_SIZE bytes ($(echo "scale=0; $MIN_SIZE*100/$UNMIN_SIZE" | bc)% of original)"

echo ""
echo "What users actually download over network (gzipped):"
printf "  Minimal: %9.1f KB\n" "$(echo "scale=1; $MIN_GZIP/1024" | bc)"
printf "  Query:   %9.1f KB (+%.1f KB)\n" "$(echo "scale=1; $QUERY_GZIP/1024" | bc)" "$(echo "scale=1; ($QUERY_GZIP-$MIN_GZIP)/1024" | bc)"
printf "  Full:    %9.1f KB (+%.1f KB)\n" "$(echo "scale=1; $FULL_GZIP/1024" | bc)" "$(echo "scale=1; ($FULL_GZIP-$MIN_GZIP)/1024" | bc)"
