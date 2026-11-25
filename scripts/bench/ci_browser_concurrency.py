"""Counterbalanced hosted benchmark of complete adapter-oracle selections.

This measures the first CP-SAT browser pair on unchanged source. Each selected
unit runs with its existing history budget. JSON reports reject an empty or
partial selection. Linux process sampling measures aggregate resident memory,
CPU use, and child processes that remain after Vitest exits.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
import json
import os
from pathlib import Path
import platform
import signal
import subprocess
import threading
import time

ROOT = Path(__file__).resolve().parents[2]
PACKAGE = ROOT / 'packages/browser-db-sqlite-persistence'
BASE = '8be91cd7647647438552edacb694f4a171692632'


@dataclass(frozen=True)
class Selection:
    name: str
    file: str
    passed: int
    total: int
    pattern: str | None = None


# The actual first pair in the CP-SAT plan: the longest fixed-seed decoder
# campaign beside four complete peer suites. Only the decoder is partitioned.
WORKERS = (
    (Selection('native-decode-fixed',
               'e2e/native-powersync-batch-decode-oracle.browser.test.ts',
               166, 876, r'^adapter\.powersync\.batch-decode\.chromium > fixed seed '),),
    (
        Selection('trailbase-hydration', 'tests/trailbase-hydration-oracle.test.ts', 90, 90),
        Selection('query-cross-adapter', 'e2e/query-cross-adapter-oracle.browser.test.ts', 185, 185),
        Selection('direct-shared-client', 'e2e/powersync-direct-shared-client-oracle.browser.test.ts', 299, 299),
        Selection('direct-persisted-demand', 'e2e/powersync-direct-persisted-demand-oracle.browser.test.ts', 50, 50),
    ),
)


def validate_report(report: dict, selection: Selection) -> list[str]:
    errors = []
    expected = {
        'numPassedTests': selection.passed,
        'numTotalTests': selection.total,
        'numFailedTests': 0,
        'numPendingTests': selection.total - selection.passed,
        'numTodoTests': 0,
    }
    for field, count in expected.items():
        if report.get(field, 0) != count:
            errors.append(f'{field}: expected {count}, received {report.get(field)}')
    if report.get('success') is not True:
        errors.append('Vitest did not report success')
    if report.get('numRuntimeErrorTestSuites', 0):
        errors.append('Vitest reported runtime errors')
    return errors


@dataclass(frozen=True)
class Process:
    pid: int
    parent: int
    group: int
    started: int
    state: str
    rss: int
    ticks: int
    name: str


def parse_process(text: str, page_size: int) -> Process:
    pid, rest = text.split(' (', 1)
    name, tail = rest.rsplit(') ', 1)
    values = tail.split()
    return Process(int(pid), int(values[1]), int(values[2]), int(values[19]),
                   values[0], int(values[21]) * page_size,
                   int(values[11]) + int(values[12]), name)


def processes() -> dict[int, Process]:
    found = {}
    for file in Path('/proc').glob('[0-9]*/stat'):
        try:
            item = parse_process(file.read_text(), os.sysconf('SC_PAGE_SIZE'))
            found[item.pid] = item
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            pass
    return found


def owned_processes(rows: dict[int, Process], groups: set[int],
                    seen: set[tuple[int, int]]) -> list[Process]:
    owned = {p.pid for p in rows.values()
             if p.group in groups or (p.pid, p.started) in seen}
    while True:
        children = {p.pid for p in rows.values() if p.parent in owned}
        if children <= owned:
            return [p for p in rows.values() if p.pid in owned]
        owned |= children


def cpu_ticks() -> tuple[int, int]:
    values = [int(v) for v in Path('/proc/stat').read_text().splitlines()[0].split()[1:9]]
    return sum(values), values[3] + values[4]


class Sampler:
    def __init__(self, directory: Path):
        self.directory = directory
        self.groups: set[int] = set()
        self.seen: set[tuple[int, int]] = set()
        self.lock = threading.Lock()
        self.stop = threading.Event()
        self.peak_rss = 0
        self.peak_processes = 0
        self.peak_chromium = 0
        self.samples = 0
        self.errors: list[str] = []

    def add(self, pid: int) -> None:
        with self.lock:
            self.groups.add(pid)

    def sample(self) -> tuple[dict, list[Process]]:
        rows = processes()
        with self.lock:
            owned = owned_processes(rows, self.groups, self.seen)
            self.seen.update((p.pid, p.started) for p in owned)
        live = [p for p in owned if p.state not in ('Z', 'X')]
        rss = sum(p.rss for p in live)
        chromium = sum('chrome' in p.name or 'chromium' in p.name for p in live)
        self.peak_rss = max(self.peak_rss, rss)
        self.peak_processes = max(self.peak_processes, len(live))
        self.peak_chromium = max(self.peak_chromium, chromium)
        self.samples += 1
        return {'monotonic': time.monotonic(), 'rss_bytes': rss,
                'processes': len(live), 'chromium_processes': chromium,
                'load_average': os.getloadavg()}, live

    def run(self) -> None:
        try:
            with (self.directory / 'resources.jsonl').open('w') as stream:
                while not self.stop.is_set():
                    sample, _ = self.sample()
                    stream.write(json.dumps(sample) + '\n')
                    stream.flush()
                    self.stop.wait(1)
        except Exception as error:
            self.errors.append(repr(error))
            self.stop.set()

    def cleanup_check(self) -> list[dict]:
        deadline = time.monotonic() + 5
        while True:
            _, live = self.sample()
            if not live or time.monotonic() >= deadline:
                break
            self.stop.wait(0.2)
        remaining = [asdict(p) for p in live]
        # A leaked process invalidates the phase. Stop only recorded descendants
        # with the same Linux start identity before measuring the next phase.
        for sig in (signal.SIGTERM, signal.SIGKILL):
            for p in live:
                current = processes().get(p.pid)
                if current and current.started == p.started:
                    try:
                        os.kill(p.pid, sig)
                    except ProcessLookupError:
                        pass
        return remaining


def run_selection(selection: Selection, directory: Path, sampler: Sampler) -> dict:
    output = directory / f'{selection.name}.json'
    args = ['pnpm', 'exec', 'vitest', 'run', '--config',
            'vitest.adapter-oracles.config.ts', selection.file,
            '--maxWorkers=1', '--reporter=default', '--reporter=json',
            f'--outputFile.json={output}']
    if selection.pattern:
        args.append(f'--testNamePattern={selection.pattern}')
    started = time.monotonic()
    errors = []
    code = None
    try:
        with (directory / f'{selection.name}.log').open('w') as log:
            child = subprocess.Popen(args, cwd=PACKAGE, stdout=log,
                                     stderr=subprocess.STDOUT, start_new_session=True)
            sampler.add(child.pid)
            code = child.wait()
        if code != 0:
            errors.append(f'Vitest exited with {code}')
        report = json.loads(output.read_text())
        errors.extend(validate_report(report, selection))
    except (OSError, ValueError) as error:
        errors.append(str(error))
    result = {'selection': asdict(selection), 'command': args,
              'seconds': time.monotonic() - started, 'exit_code': code,
              'errors': errors}
    (directory / f'{selection.name}.measurement.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'selection': selection.name, 'seconds': result['seconds'],
                      'errors': errors}), flush=True)
    return result


def run_phase(mode: str, directory: Path, workers=WORKERS) -> dict:
    directory.mkdir(parents=True)
    sampler = Sampler(directory)
    monitor = threading.Thread(target=sampler.run)
    started = time.monotonic()
    cpu_start = cpu_ticks()
    monitor.start()

    def worker(selections):
        return [run_selection(s, directory, sampler) for s in selections]

    try:
        if mode == 'parallel':
            with ThreadPoolExecutor(max_workers=2) as executor:
                futures = [executor.submit(worker, queue) for queue in workers]
                results = [future.result() for future in futures]
        else:
            results = [worker(queue) for queue in workers]
        work_seconds = time.monotonic() - started
        remaining = sampler.cleanup_check()
    finally:
        sampler.stop.set()
        monitor.join()
    cpu_end = cpu_ticks()
    delta = cpu_end[0] - cpu_start[0]
    result = {'mode': mode, 'work_seconds': work_seconds,
              'seconds_with_cleanup': time.monotonic() - started,
              'host_cpu_busy_percent': 100 * (delta - cpu_end[1] + cpu_start[1]) / delta if delta else 0,
              'peak_sampled_rss_bytes': sampler.peak_rss,
              'peak_processes': sampler.peak_processes,
              'peak_chromium_processes': sampler.peak_chromium,
              'sample_count': sampler.samples, 'sampler_errors': sampler.errors,
              'remaining_processes': remaining, 'workers': results,
              'ok': not remaining and not sampler.errors and sampler.samples > 1
              and all(not s['errors'] for queue in results for s in queue)}
    (directory / 'phase.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


def compare(phases: list[dict]) -> dict:
    by = {p['mode']: p for p in phases}
    serial, parallel = by['serial'], by['parallel']
    worker_ratios = []
    for before, after in zip(serial['workers'], parallel['workers'], strict=True):
        worker_ratios.append(sum(s['seconds'] for s in after) / sum(s['seconds'] for s in before))
    return {'ok': all(p['ok'] for p in phases),
            'serial_seconds': serial['work_seconds'],
            'parallel_seconds': parallel['work_seconds'],
            'speedup': serial['work_seconds'] / parallel['work_seconds'],
            'worker_slowdown_factors': worker_ratios,
            'worst_worker_slowdown_factor': max(worker_ratios),
            'peak_sampled_rss_bytes': max(p['peak_sampled_rss_bytes'] for p in phases),
            'units_per_phase': sum(s.passed for q in WORKERS for s in q)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--order', required=True, choices=['serial-first', 'parallel-first'])
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--preflight', action='store_true')
    args = parser.parse_args()
    if platform.system() != 'Linux' or os.cpu_count() != 4:
        raise RuntimeError('The CP-SAT experiment requires a four-core Linux hosted runner')
    for key in ['SEED', 'PATH', 'PROPERTY', 'UNIT', 'CALIBRATION']:
        if os.environ.get(f'TANSTACK_DB_ORACLE_{key}') is not None:
            raise RuntimeError('The benchmark requires ordinary campaigns without replay overrides')
    if os.environ.get('TANSTACK_DB_ORACLE_RUNS_MULTIPLIER', '1') != '1':
        raise RuntimeError('The benchmark requires the unchanged run multiplier')
    subprocess.run(['git', 'diff', '--exit-code', BASE, 'HEAD', '--',
                    'packages', 'package.json', 'pnpm-lock.yaml', '.nvmrc'], cwd=ROOT, check=True)
    args.output = args.output.resolve()
    args.output.mkdir(parents=True, exist_ok=True)
    metadata = {'base': BASE, 'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
                'cpus': os.cpu_count(), 'platform': platform.platform(),
                'node': subprocess.check_output(['node', '--version'], text=True).strip(),
                'memory': Path('/proc/meminfo').read_text().splitlines()[:3],
                'order': args.order,
                'limits': ['Random peer histories retain fresh seeds and may vary.',
                           'RSS and child-process counts are sampled every second.',
                           'CPU includes background runner work.',
                           'This experiment does not establish full-CI clock time.']}
    if metadata['node'] != 'v' + (ROOT / '.nvmrc').read_text().strip():
        raise RuntimeError('The benchmark must use the repository Node version')
    (args.output / 'metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
    if args.preflight:
        selected = WORKERS[0][0]
        selected = Selection('decoder-selection-preflight', selected.file, 1,
                             selected.total, selected.pattern +
                             '2377: generated eager:initial:valid 1$')
        result = run_phase('serial', args.output / 'selection', ((selected,),))
        return 0 if result['ok'] else 1
    order = ['serial', 'parallel'] if args.order == 'serial-first' else ['parallel', 'serial']
    phases = [run_phase(mode, args.output / mode) for mode in order]
    summary = compare(phases)
    (args.output / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    text = ('# Hosted browser concurrency experiment\n\n'
            f'Order: `{args.order}`. Units per phase: {summary["units_per_phase"]}.\n\n'
            '| Serial seconds | Parallel seconds | Speedup | Worker slowdown | Peak sampled RSS |\n'
            '| ---: | ---: | ---: | --- | ---: |\n'
            f'| {summary["serial_seconds"]:.1f} | {summary["parallel_seconds"]:.1f} | '
            f'{summary["speedup"]:.3f} | {summary["worker_slowdown_factors"]} | '
            f'{summary["peak_sampled_rss_bytes"] / 2**30:.2f} GiB |\n\n'
            f'Valid: `{summary["ok"]}`. Full reports, seeds and resource samples are in the artifact.\n')
    (args.output / 'summary.md').write_text(text)
    print(text, flush=True)
    return 0 if summary['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
