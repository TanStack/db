# OpenTelemetry Setup

This example includes OpenTelemetry instrumentation for observability of offline transactions.

## Quick Start

### 1. Set up Honeycomb API Key

```bash
cp .env.example .env
# Edit .env and add your Honeycomb API key
```

Get your API key from https://ui.honeycomb.io/account

### 2. Start the OpenTelemetry Collector

```bash
docker-compose up -d
```

This starts the OpenTelemetry Collector with CORS support on port 4318.

### 3. Enable Tracing in the App

Uncomment the tracing configuration in `src/routes/indexeddb.tsx` or `src/routes/localstorage.tsx`:

```typescript
const offlineExecutor = createIndexedDBOfflineExecutor({
  endpoint: "http://localhost:4318/v1/traces",
})
```

### 4. View Traces in Honeycomb

1. Go to https://ui.honeycomb.io
2. Navigate to your environment
3. You should see traces from `@tanstack/offline-transactions-example`

## What Gets Traced

The offline transactions package instruments:

- **Transaction execution**: Full lifecycle from persistence to completion
- **Outbox operations**: add, get, update, remove transactions
- **Retry logic**: Failed transactions with retry attempts and delays
- **Error handling**: Failed spans with error details and stack traces
- **Scheduler operations**: Transaction queuing and batching

## Configuration Options

### Using Jaeger (Local Development)

If you prefer Jaeger for local development:

1. Uncomment the `jaeger` service in `docker-compose.yml`
2. Update `otel-collector-config.yaml` to use the Jaeger exporter
3. Access Jaeger UI at http://localhost:16686

### Custom Honeycomb Configuration

You can pass headers for Honeycomb configuration:

```typescript
const offlineExecutor = createIndexedDBOfflineExecutor({
  endpoint: "http://localhost:4318/v1/traces",
  headers: {
    // Optional: specify dataset
    "x-honeycomb-dataset": "my-dataset",
  },
})
```

## Troubleshooting

### CORS Errors

If you see CORS errors, verify:

- The collector is running: `docker-compose ps`
- Port 4318 is accessible: `curl http://localhost:4318`
- The `allowed_origins` in `otel-collector-config.yaml` matches your app's origin

### No Traces Appearing

Check collector logs:

```bash
docker-compose logs otel-collector
```

Verify your Honeycomb API key is correct:

```bash
docker-compose exec otel-collector env | grep HONEYCOMB
```

### Stopping the Collector

```bash
docker-compose down
```
