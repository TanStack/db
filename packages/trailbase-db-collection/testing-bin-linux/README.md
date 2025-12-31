# TrailBase Binary for E2E Testing

Place the TrailBase binary in this directory to run e2e tests without Docker.

## Download Instructions

```bash
# Download TrailBase binary
curl -sSL https://trailbase.io/install.sh | bash

# Move to this directory
mv trail packages/trailbase-db-collection/testing-bin-linux/trail
```

The e2e test setup will automatically detect and use this binary if present.
If the binary is not found, it will fall back to Docker.
