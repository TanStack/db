#!/bin/bash

echo "=== Analyzing @tanstack/db-ivm Impact ==="
echo ""

# Check if db-ivm is built
if [ ! -d "packages/db-ivm/dist" ]; then
  echo "Building db-ivm..."
  cd packages/db-ivm && pnpm build > /dev/null 2>&1 && cd ../..
fi

echo "1. What's in db-ivm main export?"
echo ""
grep "^export" packages/db-ivm/src/index.ts
echo ""

echo "2. db-ivm file sizes:"
find packages/db-ivm/dist/esm -name "*.js" -type f 2>/dev/null | xargs du -h | sort -h | tail -15

echo ""
echo "3. Total db-ivm size:"
du -sh packages/db-ivm/dist/esm 2>/dev/null || echo "Not built"

echo ""
echo "4. Does @tanstack/db actually import from db-ivm?"
grep -r "from.*db-ivm" packages/db/src/ | head -5

echo ""
echo "5. Where is db-ivm used?"
grep -r "@tanstack/db-ivm" packages/db/dist/esm/*.js 2>/dev/null | head -3 || echo "Checking source..."
grep -r "@tanstack/db-ivm" packages/db/src/**/*.ts 2>/dev/null | wc -l | xargs echo "  Import count:"
