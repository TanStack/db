# TrailBase Binary for E2E Testing

Place the TrailBase binary in this directory to run e2e tests without Docker.

**Important**: Make sure you download the correct architecture binary (x86_64 for most CI systems).

## Download Instructions

```bash
# Download TrailBase binary for your architecture
# For x86_64 Linux:
curl -L -o trail https://github.com/trailbase/trailbase/releases/latest/download/trail-x86_64-unknown-linux-gnu

# For ARM64 Linux:
curl -L -o trail https://github.com/trailbase/trailbase/releases/latest/download/trail-aarch64-unknown-linux-gnu

# Make executable
chmod +x trail

# Move to this directory
mv trail packages/trailbase-db-collection/testing-bin-linux/trail
```

The setup also checks `packages/trailbase/test-linux-bin/trail` as an alternative location.

The e2e test setup will automatically detect and use this binary if present.
If the binary is not found, it will fall back to Docker.
