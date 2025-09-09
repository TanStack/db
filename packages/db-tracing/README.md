# @tanstack/db-tracing

Internal tracing utilities for TanStack DB.

## Usage

```typescript
import { 
  setTracingEnabled, 
  addTracer, 
  PerformanceMarkTracer 
} from '@tanstack/db-tracing'

// Enable tracing with performance marks (for browser devtools)
setTracingEnabled(true)
addTracer(new PerformanceMarkTracer())

// All TanStack DB operations are now automatically traced
```

## License

MIT