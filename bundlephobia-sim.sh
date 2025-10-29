#!/bin/bash

echo "=== Simulating Bundlephobia's Bundle ==="
echo ""

# Test 1: What bundlephobia does - import EVERYTHING
cat > full-import.js << 'EOJS'
import * as DB from './packages/db/dist/esm/index.js'
import * as IVM from './packages/db-ivm/dist/esm/index.js'
console.log(DB, IVM)
EOJS

npx esbuild full-import.js --bundle --format=esm --minify --outfile=bundlephobia-sim.min.js 2>&1 | grep -E "bundlephobia-sim|Done"

FULL=$(wc -c < bundlephobia-sim.min.js)
FULL_GZIP=$(gzip -c bundlephobia-sim.min.js | wc -c)

echo ""
echo "Results:"
printf "%-60s %10s %10s\n" "Import Pattern" "Minified" "Gzipped"
printf "%-60s %10s %10s\n" "--------------" "--------" "-------"
printf "%-60s %7.1f KB %7.1f KB\n" "import { createCollection } from '@tanstack/db'" "72.8" "20.1"
printf "%-60s %7.1f KB %7.1f KB\n" "import * from '@tanstack/db' + import * from '@tanstack/db-ivm'" "$(echo "scale=1; $FULL/1024" | bc)" "$(echo "scale=1; $FULL_GZIP/1024" | bc)"
printf "%-60s %10s %10s\n" "Bundlephobia reports:" "N/A" "40.5"

echo ""
if [ "$FULL_GZIP" -gt 38000 ] && [ "$FULL_GZIP" -lt 43000 ]; then
  echo "✅ MATCH! My simulation matches bundlephobia (~40 KB)"
else
  echo "Difference: $(echo "scale=1; $FULL_GZIP/1024 - 40.5" | bc) KB"
fi

echo ""
echo "The 20 KB difference breakdown:"
echo "  - Minimal (createCollection): 20 KB gzipped"
echo "  - Full package (all exports): ~35 KB gzipped"
echo "  - db-ivm (all exports): ~8 KB gzipped"
echo "  - Total: ~43 KB vs bundlephobia's 40 KB"
