# @tanstack/db-skills

AI-agent-optimized documentation for [TanStack DB](https://tanstack.com/db).

## What is this?

This package provides structured documentation designed for AI coding assistants (Claude Code, Cursor, Copilot, etc.) to help them build TanStack DB applications effectively.

Skills are distilled, task-focused patterns that agents can quickly consume and apply - unlike large documentation that often exceeds context limits.

## Installation

```bash
npm install @tanstack/db-skills
```

## CLI Usage

```bash
# List all available skills
npx @tanstack/db-skills list

# Show a specific skill
npx @tanstack/db-skills show tanstack-db
npx @tanstack/db-skills show tanstack-db/live-queries
npx @tanstack/db-skills show tanstack-db/mutations
```

## Skills Structure

| Skill | Purpose |
|-------|---------|
| `tanstack-db` | Router/entry point with routing table |
| `tanstack-db/live-queries` | Reactive queries, joins, aggregations |
| `tanstack-db/mutations` | Optimistic updates, transactions, paced mutations |
| `tanstack-db/collections` | QueryCollection, ElectricCollection, sync modes |
| `tanstack-db/schemas` | Validation, transformations, TInput/TOutput |
| `tanstack-db/electric` | ElectricSQL integration, txid matching |

Each skill includes:
- **SKILL.md** - Common patterns and routing table
- **references/** - Deep-dive documentation for specialized topics

## For AI Agents

Point your agent to the skills directory or use the CLI to fetch specific skills:

```bash
# Get the main routing skill
npx @tanstack/db-skills show tanstack-db

# Get specific domain skills
npx @tanstack/db-skills show tanstack-db/live-queries
```

The router skill (`tanstack-db`) contains a routing table that helps agents find the right sub-skill for any task.

## Learn More

- [TanStack DB Documentation](https://tanstack.com/db)
- [TanStack DB GitHub](https://github.com/TanStack/db)
