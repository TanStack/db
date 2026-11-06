// The CLI's arguments, shared by the CLI (index.mjs) and the daemon
// (daemon.mjs), which parses each request's arguments the same way.
import { realpathSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { resolve } from 'node:path'

const flags = new Set([`daemon`, `stop-daemon`, `ordinary`])
/**
 * The options in `argv`. Paths are resolved against `cwd`, the caller's
 * working directory, which the daemon receives with each request.
 */
export function parseArgs(argv, cwd = process.cwd()) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const [key, inline] = argv[i].replace(/^--/, ``).split(`=`)
    args[key] = flags.has(key) ? true : (inline ?? argv[++i])
  }
  if (!args.package) throw new Error(`--package is required`)
  // Test reports name files by their real path (on macOS, /tmp is
  // /private/tmp), so the package path is resolved the same way.
  const pkg = realpathSync(resolve(cwd, args.package))
  if (args[`stop-daemon`]) return { stop: true, pkg }
  if (!args.source) throw new Error(`--package and --source are required`)
  return {
    pkg,
    daemon: args.daemon === true,
    // Ordinary (non-oracle) test files run only when asked: they never close
    // a gap, and only report whether they would have caught a survivor.
    ordinary: args.ordinary === true,
    // Each warm context runs one mutant at a time with one worker. Measured on
    // main's LocalStorage owners (320 mutants): 2 contexts 297 s, 4 185 s,
    // 8 137 s, with identical oracle-tier classes.
    contexts: Number(
      args.contexts ?? Math.min(8, Math.max(2, availableParallelism() - 2)),
    ),
    sources: args.source.split(`,`),
    seed: args.seed,
    diffBase: args[`diff-base`],
    out: resolve(cwd, args.out ?? `/tmp/oracle-gaps`),
    only: args.only ? new Set(args.only.split(`,`)) : undefined,
    // A fixed-seed random sample of this many mutants per source file, for
    // surveys across many modules.
    sample: args.sample ? Number(args.sample) : undefined,
    // A mutant can make a test hang. Oracles that run in milliseconds do not
    // need Vitest's default limits, which would make each hang cost seconds.
    testTimeout: Number(args[`test-timeout`] ?? 15000),
    // A directory of authored mutants (see loadAuthored).
    mutants: args.mutants ? resolve(cwd, args.mutants) : undefined,
  }
}

