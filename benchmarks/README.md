# TanStack DB Initial Load Benchmark

This benchmark measures the performance of TanStack DB collections when loading initial datasets and executing complex queries with joins.

## What it benchmarks

The benchmark creates three collections representing an issue tracker:
- **Projects**: Basic project information
- **Issues**: Issues associated with projects
- **Comments**: Comments on issues

It then creates a complex query that joins all three collections and measures how long it takes for the query to become ready (simulating a prefetch operation).

## Dataset sizes

The benchmark runs with four different dataset sizes:

1. **Small**: 10 projects, 50 issues, 200 comments
2. **Medium**: 50 projects, 250 issues, 1,000 comments  
3. **Large**: 100 projects, 500 issues, 2,000 comments
4. **Very Large**: 200 projects, 1,000 issues, 5,000 comments

## Running the benchmark

### Full benchmark (all dataset sizes)
```bash
pnpm benchmark
```

### Individual dataset sizes
```bash
# Small dataset only
pnpm benchmark:small

# Medium dataset only  
pnpm benchmark:medium

# Large dataset only
pnpm benchmark:large
```

### Custom dataset size
```bash
tsx -e "
import('./initial-load.ts').then(m => 
  m.benchmarkInitialLoad(100, 500, 2000, 3)
)
"
```

## What gets measured

For each dataset size, the benchmark:
1. Generates test data
2. Creates TanStack DB collections
3. Populates collections with data
4. Creates a complex join query
5. Measures time for query to become ready
6. Runs multiple iterations for statistical accuracy
7. Reports average, min, max, and standard deviation

## Query structure

The benchmark query performs:
- Left join from projects to issues (by project_id)
- Left join from issues to comments (by issue_id)
- Selects fields from all three collections

This simulates a real-world scenario where you need to display project information with all related issues and comments.

## Performance metrics

The benchmark reports:
- **Average time**: Mean time across all iterations
- **Min/Max time**: Best and worst performance
- **Standard deviation**: Consistency of performance
- **Result count**: Number of rows returned by the query

## Use cases

This benchmark is useful for:
- Comparing TanStack DB performance across versions
- Testing performance on different hardware
- Understanding how collection size affects query performance
- Validating that performance meets application requirements
- Identifying performance bottlenecks in complex queries

## Requirements

- Node.js 18+ (for ES modules support)
- TanStack DB workspace dependencies
- pnpm (for workspace management)
- TypeScript support (included in devDependencies)

## Development

The benchmark is written in TypeScript and includes:
- Type definitions for all data structures
- Proper typing for TanStack DB collections and queries
- Type-safe function signatures
- TypeScript configuration for strict type checking

### Available scripts:
- `pnpm benchmark` - Run the full benchmark
- `pnpm type-check` - Check TypeScript types without running
- `pnpm build` - Compile TypeScript to JavaScript
