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
    // offline-transactions' FIFO executor (163 mutants, 18 cores): 8 contexts
    // 124 s, 16 contexts 91 s, with identical classes.
    contexts: Number(
      args.contexts ?? Math.min(16, Math.max(2, availableParallelism() - 2)),
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
    // The base of each mutant run's time limit, in milliseconds; the limit
    // adds three times the file's unmutated duration (see limitFor).
    hangLimit: Number(args[`hang-limit`] ?? 10000),
    // A directory of authored mutants (see loadAuthored).
    mutants: args.mutants ? resolve(cwd, args.mutants) : undefined,
  }
}

