# Workflow 6 — preview a stricter global level

The project currently uses Endpoints level `standard`. A maintainer is
considering `strict`, which may activate rules or claim uses that are absent
from the live resolved configuration. Before editing or committing config, the
maintainer wants a complete account of newly required evidence, reusable
existing evidence, new policy-blocking conditions, and the maintenance work the
change would create.

Simulate a TypeScript, MCP, or CLI interaction that constructs the sealed
candidate bundle and compares it with the current snapshot without writing live
conditions or work. Show how the agent would explain contributing config layers,
missing module definitions, invalid candidate config, and what becomes durable
only if the maintainer later applies the change.
