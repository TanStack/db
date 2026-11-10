"""Exact six-command native-list wrapper. Importing this file does not launch.

Reuse: H/current-impact-v1/run-current-capped.py's new-session subprocess,
monotonic sampling, ps group RSS and conditional group cleanup. This successor
adds immutable recipe binding, durable receipts and list-only qualification.
No test body, product oracle or receiving claim is part of this launcher.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
WORKTREE = HERE.parent.parent
ORIGINAL = WORKTREE / 'docs/misfits-metadata-receiving-preparation-v1'
V2 = WORKTREE / 'docs/misfits-metadata-receiving-recipes-v2'
OUTPUT = WORKTREE / 'docs/misfits-metadata-receiving-native-list-v2'
RECIPE_SHA = '8d72b7b9458f7a4c92634eac46fa3a8c6af09fc9e22031c253bc62e86b44c704'
SOURCE_SHA = '888ff265816fe90252d1d4ad674ac98ac57c294c18498fb0b88277a687cd5a8a'
PACKETS = [(ORIGINAL, '1332c3f797f8a2f34e7bca47c929f1bbfae7f398a7f7021c39e469675a2cf941'),
           (V2, '234ce9bd710d35915ea4a57a43043bde641d9cf468c060da9176b360793a6a30')]
UNSET = ['H02_PROGRESS_BINDING_DIR', 'H02_PROGRESS_RECEIPTS',
         'H02_PROGRESS_WORKER_HISTORY', 'H02_PROGRESS_SELECTED_ROOT',
         'H02_PROGRESS_SOURCE_FREEZE', 'NODE_OPTIONS', 'NODE_PATH',
         'TANSTACK_DB_ORACLE_SEED', 'TANSTACK_DB_ORACLE_PATH',
         'TANSTACK_DB_ORACLE_PROPERTY', 'TANSTACK_DB_ORACLE_CALIBRATION']
PS_ARGV = ['/bin/ps', '-A', '-o', 'pid=,pgid=,rss=,stat=']


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def load_json(path):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, f'duplicate JSON key: {key}')
            result[key] = value
        return result
    def bad_constant(value):
        raise ValueError(f'non-finite JSON constant: {value}')
    return json.loads(Path(path).read_text(encoding='utf-8'),
                      object_pairs_hook=pairs, parse_constant=bad_constant)


def sync_directory(path):
    directory = os.open(path, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def durable_json(path, value):
    """Exclusive, synchronous file plus directory fsync; never overwrite."""
    path = Path(path)
    with path.open('x', encoding='utf-8') as file:
        file.write(json.dumps(value, indent=2, sort_keys=True) + '\n')
        file.flush()
        os.fsync(file.fileno())
    sync_directory(path.parent)


def verify_packet(directory, expected):
    require(digest(directory / 'packet-manifest.json') == expected,
            f'packet manifest changed: {directory}')
    manifest = load_json(directory / 'packet-manifest.json')
    actual = {str(p.relative_to(directory)) for p in directory.rglob('*') if p.is_file()}
    require(actual == set(manifest['members']) | {'packet-manifest.json'}, 'packet file set changed')
    for name, item in manifest['members'].items():
        path = directory / name
        require(path.stat().st_size == item['bytes'] and digest(path) == item['sha256'],
                f'packet member changed: {path}')


def verify_inputs(binding_sha):
    require(digest(HERE / 'binding.json') == binding_sha, 'launcher binding hash changed')
    binding = load_json(HERE / 'binding.json')
    require(sys.executable == binding['python']['executable'] and
            digest(sys.executable) == binding['python']['sha256'], 'Python interpreter changed')
    for name, expected in binding['launcherFiles'].items():
        require(digest(HERE / name) == expected, f'launcher source changed: {name}')
    for directory, expected in PACKETS:
        verify_packet(directory, expected)
    require(digest(ORIGINAL / 'source-freeze.json') == SOURCE_SHA, 'source freeze changed')
    require(digest(V2 / 'inert-native-list-recipes.json') == RECIPE_SHA, 'list recipes changed')
    source = load_json(ORIGINAL / 'source-freeze.json')
    merged = {}
    for key in ['productionFiles', 'receivingProductionFiles', 'instrumentFiles', 'sharedInstrumentFiles']:
        for name, expected in source[key].items():
            require(name not in merged or merged[name] == expected, 'conflicting source maps')
            merged[name] = expected
    require(len(merged) == 573, 'unexpected source map size')
    for name, expected in merged.items():
        require(digest(WORKTREE / name) == expected, f'active source changed: {name}')
    for item in source['packages'].values():
        require(str((WORKTREE / item['logical']).resolve()) == item['resolved'], 'dependency resolution changed')
        actual = set()
        base = Path(item['resolved'])
        for directory, directories, files in os.walk(base, followlinks=False):
            directories[:] = [part for part in directories if part != 'node_modules' and
                              not (Path(directory) / part).is_symlink()]
            for name in files:
                path = Path(directory) / name
                if path.is_file() and not path.is_symlink():
                    actual.add(str(path.relative_to(base)))
        require(actual == set(item['regularPayloadFilesMap']), 'dependency own-payload file set changed')
        for name, expected in item['regularPayloadFilesMap'].items():
            require(digest(Path(item['resolved']) / name) == expected, f'dependency bytes changed: {name}')
    for name, item in source['dependencyReuseLinks'].items():
        path = WORKTREE / name
        require(path.is_symlink() == item['isSymlink'] and str(path.resolve()) == item['resolved'],
                f'dependency reuse link changed: {name}')
    require(digest(source['node']['executable']) == source['node']['sha256'], 'Node changed')
    require(digest(WORKTREE / 'pnpm-lock.yaml') == source['lockfiles']['repoPnpmLock'], 'repo lock changed')
    require(digest(WORKTREE / 'node_modules/.pnpm/lock.yaml') == source['lockfiles']['installedPnpmLock'],
            'installed lock changed')
    batch = load_json(V2 / 'inert-native-list-recipes.json')
    require(len(batch['recipes']) == 6, 'expected exactly six inert recipes')
    out = Path(batch['freshOutputDirectory'])
    require(out == OUTPUT, 'unexpected output root')
    for index, recipe in enumerate(batch['recipes']):
        require(recipe['order'] == index and recipe['maxWorkers'] == 1 and not recipe['fileParallelism'],
                'recipe order/concurrency changed')
        require(recipe['outerWallContainmentMs'] == 30000 and recipe['groupRssContainmentBytes'] == 2147483648,
                'recipe containment changed')
        require(recipe['argv'][2] == 'list' and '--maxWorkers=1' in recipe['argv'] and
                '--no-file-parallelism' in recipe['argv'] and '--cache=false' in recipe['argv'],
                'recipe is not the exact bounded list shape')
        require(recipe['envUnset'] == UNSET[:5], 'H02 unset list changed')
        for key in ['stdoutPath', 'stderrPath']:
            require(Path(recipe[key]).parent == out, 'output escaped root')
        require(Path(recipe['expectedOutput']['path']).parent == out, 'JSON escaped root')
    return batch, {'sourceFiles': len(merged), 'namedPackagePayloadFiles':
                   sum(len(p['regularPayloadFilesMap']) for p in source['packages'].values()),
                   'sourceFreezeSha256': SOURCE_SHA, 'recipesSha256': RECIPE_SHA}


def parse_ps(text, pid, pgid):
    rows = []
    for line in text.splitlines():
        fields = line.split()
        require(len(fields) == 4, 'malformed process inventory row')
        row = dict(zip(['pid', 'pgid', 'rssBytes', 'stat'],
                       [int(fields[0]), int(fields[1]), int(fields[2]) * 1024, fields[3]]))
        require(row['pid'] >= 0 and row['pgid'] >= 0 and row['rssBytes'] >= 0, 'invalid process inventory')
        if row['pid'] == pid or row['pgid'] == pgid:
            rows.append(row)
    return rows


def inventory(pid, pgid):
    result = subprocess.run(PS_ARGV, capture_output=True, text=True, timeout=1, check=True)
    require(not result.stderr, 'ps emitted stderr')
    return parse_ps(result.stdout, pid, pgid)


def qualify_output(recipe):
    path = Path(recipe['expectedOutput']['path'])
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size <= 1048576,
            'JSON is not a bounded fresh regular file')
    values = load_json(path)
    after = path.lstat()
    require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) ==
            (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns), 'JSON identity changed')
    expected = recipe['expectedOutput']
    require(isinstance(values, list) and len(values) == expected['count'], 'wrong native list count')
    names = []
    for value in values:
        require(isinstance(value, dict) and value.get('file') == expected['module'] and
                isinstance(value.get('name'), str), 'wrong native list entry/module')
        names.append(value['name'])
    require(len(set(names)) == len(names) and sorted(names) == sorted(expected['names']),
            'wrong native list names')
    require(Path(recipe['stderrPath']).stat().st_size == 0, 'nonempty list stderr; needs review')
    stdout = Path(recipe['stdoutPath']).read_text(encoding='utf-8')
    require(not re.search(r'\b(error|unhandled|failed|fatal)\b', stdout, re.I), 'possible collection error in stdout')
    return {'jsonSha256': digest(path), 'names': names, 'count': len(names),
            'module': expected['module'], 'stderrEmpty': True}


def fail(state, phase, error):
    entry = {'phase': phase, 'error': str(error)}
    if state['primaryFailure'] is None:
        state['primaryFailure'] = entry
    else:
        state['secondaryFailures'].append(entry)


class Deadline(Exception):
    pass


def interrupted(signum, frame):
    raise Deadline(f'external signal {signum}')


def run_one(recipe, out, binding_sha):
    stem = f"{recipe['order']:02d}"
    state = {'recipeId': recipe['id'], 'primaryFailure': None, 'secondaryFailures': [],
             'pid': None, 'pgid': None, 'pgidVerified': False, 'samples': 0,
             'maxSampledGroupRssBytes': 0, 'killAttempts': [], 'remainingGroupRows': None}
    child = None
    start = time.monotonic()
    def receipt(phase):
        durable_json(out / f'{stem}-{phase}.receipt.json', dict(state, phase=phase,
                     elapsedMs=round((time.monotonic() - start) * 1000), bindingSha256=binding_sha))
    def stop_child():
        if child is None:
            return
        if state['pgidVerified']:
            # Only the known original group, while leader is live or positively inventoried.
            if child.poll() is None or state['remainingGroupRows']:
                attempt = {'targetPgid': state['pgid'], 'signal': 'SIGKILL'}
                state['killAttempts'].append(attempt)
                try:
                    os.killpg(state['pgid'], signal.SIGKILL)
                    attempt['result'] = 'sent'
                except ProcessLookupError:
                    attempt['result'] = 'already absent'
        elif child.poll() is None:
            child.kill()  # An unverified group is never signalled.
            state['killAttempts'].append({'targetPid': child.pid, 'signal': 'SIGKILL'})
    try:
        for path in [recipe['stdoutPath'], recipe['stderrPath'], recipe['expectedOutput']['path']]:
            require(not os.path.lexists(path), 'output already exists')
        state['argv'] = [recipe['executable']] + recipe['argv']
        state['cwd'] = recipe['cwd']
        env = {key: value for key, value in os.environ.items() if key not in UNSET}
        env.update({'CI': '1', 'NO_COLOR': '1'})
        state['envUnset'] = UNSET
        state['envSet'] = {'CI': '1', 'NO_COLOR': '1'}
        receipt('pre-spawn')
        remaining = 30 - (time.monotonic() - start)
        require(remaining > 0, 'wall budget expired before spawn')
        signal.setitimer(signal.ITIMER_REAL, remaining)
        with open(recipe['stdoutPath'], 'xb') as stdout, open(recipe['stderrPath'], 'xb') as stderr:
            child = subprocess.Popen(state['argv'], cwd=recipe['cwd'], env=env,
                                     stdout=stdout, stderr=stderr, start_new_session=True)
            state['pid'] = child.pid
            state['pgid'] = child.pid  # start_new_session creates this original group.
            receipt('spawn')
            actual = os.getpgid(child.pid)
            require(actual == child.pid, 'child original PGID could not be verified')
            state['pgidVerified'] = True
            receipt('group-verified')
            while True:
                rows = inventory(child.pid, state['pgid'])
                state['remainingGroupRows'] = rows
                state['samples'] += 1
                rss = sum(row['rssBytes'] for row in rows if row['pgid'] == state['pgid'])
                state['maxSampledGroupRssBytes'] = max(state['maxSampledGroupRssBytes'], rss)
                require(rss <= 2147483648, '2 GiB sampled group RSS containment')
                require((time.monotonic() - start) < 30, '30 second wall containment')
                if child.poll() is not None:
                    break
                time.sleep(.08)
            state['exitCode'] = child.wait(timeout=1)
            stdout.flush()
            stderr.flush()
            os.fsync(stdout.fileno())
            os.fsync(stderr.fileno())
            require(state['exitCode'] == 0, 'native list abnormal/nonzero exit')
            state['remainingGroupRows'] = inventory(child.pid, state['pgid'])
            require(not state['remainingGroupRows'], 'original group or PID still present')
            state['qualification'] = qualify_output(recipe)
    except BaseException as error:
        fail(state, 'native-list', error)
        try:
            receipt('failure')  # Preserve the first cause before any cleanup signal.
        except BaseException as secondary:
            fail(state, 'failure-receipt', secondary)
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        if child is not None:
            try:
                if state['primaryFailure'] is not None:
                    stop_child()
                state['exitCode'] = child.wait(timeout=3)
            except BaseException as error:
                fail(state, 'leader-cleanup', error)
            try:
                state['remainingGroupRows'] = inventory(child.pid, state['pgid'])
                if state['remainingGroupRows']:
                    fail(state, 'group-cleanup', 'original group or PID remains after wait')
                    stop_child()
                    end = time.monotonic() + 3
                    while state['remainingGroupRows'] and time.monotonic() < end:
                        time.sleep(.08)
                        state['remainingGroupRows'] = inventory(child.pid, state['pgid'])
                require(not state['remainingGroupRows'], 'original group absence unestablished')
                require(state['pgidVerified'], 'original PGID verification unestablished')
            except BaseException as error:
                fail(state, 'final-inventory', error)
        for key in ['stdoutPath', 'stderrPath']:
            try:
                if Path(recipe[key]).is_file():
                    with open(recipe[key], 'rb') as log:
                        os.fsync(log.fileno())
            except BaseException as error:
                fail(state, 'log-durability', error)
        state['elapsedMs'] = round((time.monotonic() - start) * 1000)
        try:
            receipt('final')
        except BaseException as error:
            fail(state, 'final-receipt', error)
    return state


def execute(binding_sha):
    # No subprocess or process inventory occurs before exact hash verification.
    out = OUTPUT
    out.mkdir(mode=0o700)  # Exact fixed output root is also an exclusive one-batch lock.
    sync_directory(out.parent)
    outer = {'bindingSha256': binding_sha, 'outerPid': os.getpid(), 'outerPgid': os.getpgrp(),
             'identityBefore': None, 'completedRecipes': [], 'primaryFailure': None,
             'secondaryFailures': [], 'status': 'running'}
    try:
        durable_json(out / 'outer-pre.receipt.json', outer)
        batch, identity = verify_inputs(binding_sha)
        outer['identityBefore'] = identity
        signal.signal(signal.SIGALRM, interrupted)
        signal.signal(signal.SIGTERM, interrupted)
        signal.signal(signal.SIGINT, interrupted)
        for recipe in batch['recipes']:
            # No next command while prior qualification/group knowledge is uncertain.
            state = run_one(recipe, out, binding_sha)
            outer['completedRecipes'].append(state)
            if state['primaryFailure'] is not None:
                fail(outer, recipe['id'], state['primaryFailure'])
                break
            verify_inputs(binding_sha)
        outer['status'] = 'qualified' if len(outer['completedRecipes']) == 6 and outer['primaryFailure'] is None else 'stopped'
    except BaseException as error:
        fail(outer, 'outer', error)
        outer['status'] = 'stopped'
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        try:
            durable_json(out / 'outer-final.receipt.json', outer)
        except BaseException as error:
            fail(outer, 'outer-final-receipt', error)
            outer['status'] = 'stopped'
            print(json.dumps(outer), file=sys.stderr)
    return 0 if outer['status'] == 'qualified' else 1


if __name__ == '__main__':
    require(len(sys.argv) == 3 and sys.argv[1] == '--execute-exact-batch',
            'Separate root admission required: --execute-exact-batch <binding-sha256>')
    sys.exit(execute(sys.argv[2]))
