# @tanstack/db-tracing

Internal tracing utilities for TanStack DB.

## Usage

```typescript
import { 
  setTracingEnabled, 
  addTracer, 
  PerformanceMarkTracer,
  OpenTelemetryTracer 
} from '@tanstack/db-tracing'

// Enable tracing with performance marks (for browser devtools)
setTracingEnabled(true)
addTracer(new PerformanceMarkTracer())

// Or with OpenTelemetry
import { trace } from '@opentelemetry/api'
addTracer(new OpenTelemetryTracer(trace.getTracer('tanstack-db')))

// All TanStack DB operations are now automatically traced
```

## License

MIT