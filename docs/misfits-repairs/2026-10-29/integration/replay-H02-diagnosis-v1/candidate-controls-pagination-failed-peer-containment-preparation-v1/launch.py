"""One exact primary-pagination command; importing defines functions only.

Reuse the frozen native-list run_one supervisor unchanged. Only its output
qualifier and cleared environment are configured for this exact Vitest run.
Child nonzero remains outer nonzero and requires independent assertion review.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import stat
import sys

HERE = Path(__file__).resolve().parent


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_json(path):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, f'duplicate JSON key: {key}')
            result[key] = value
        return result
    def constant(value):
        raise ValueError(f'non-finite JSON constant: {value}')
    return json.loads(Path(path).read_text(), object_pairs_hook=pairs,
                      parse_constant=constant)


def payload_names(base):
    actual = set()
    for directory, directories, files in os.walk(base, followlinks=False):
        directories[:] = [name for name in directories if name != 'node_modules'
                          and not (Path(directory) / name).is_symlink()]
        for name in files:
            path = Path(directory) / name
            if path.is_file() and not path.is_symlink():
                actual.add(str(path.relative_to(base)))
    return actual


def verify_inputs(binding_sha):
    require(digest(HERE / 'binding.json') == binding_sha, 'binding changed')
    binding = read_json(HERE / 'binding.json')
    require(sys.executable == binding['python']['executable'] and
            sys.version == binding['python']['version'] and
            digest(sys.executable) == binding['python']['sha256'], 'Python changed')
    for name, expected in binding['files'].items():
        require(Path(name).name == name and digest(HERE / name) == expected,
                f'preparation source changed: {name}')
    for key in ['supervisor', 'proposedCommand', 'sourceFreeze', 'ps']:
        item = binding[key]
        require(digest(item['path']) == item['sha256'], f'{key} changed')
    source = read_json(binding['sourceFreeze']['path'])
    worktree = Path(source['worktree'])
    require(len(source['sourceBindings']) == 595, 'source binding count changed')
    for name, expected in source['sourceBindings'].items():
        require(digest(worktree / name) == expected, f'active source changed: {name}')
    for name, expected in source['sourceCopies'].items():
        require(digest(Path(source['sourceCopyRoot']) / name) == expected,
                f'preserved source copy changed: {name}')
    require(digest(source['node']['executable']) == source['node']['sha256'], 'Node changed')
    for name, item in source['dependencyReuseLinks'].items():
        path = worktree / name
        require(path.is_symlink() == item['isSymlink'] and str(path.resolve()) == item['resolved'],
                f'dependency reuse link changed: {name}')
    for relative, expected in [('pnpm-lock.yaml', source['lockfiles']['repoPnpmLock']),
                               ('node_modules/.pnpm/lock.yaml', source['lockfiles']['installedPnpmLock'])]:
        require(digest(worktree / relative) == expected, f'lock changed: {relative}')
    packages = list(source['packages'].values())
    supplemental = read_json(HERE / 'supplemental-tool-inputs.json')
    packages += supplemental['packages']
    seen = set()
    payloads = 0
    for item in packages:
        logical = Path(item['logical'])
        if not logical.is_absolute():
            logical = worktree / logical
        require(str(logical.resolve()) == item['resolved'], f'package resolution changed: {logical}')
        base = Path(item['resolved'])
        if str(base) in seen:
            continue
        seen.add(str(base))
        expected = item['regularPayloadFilesMap']
        require(payload_names(base) == set(expected), f'package own-payload set changed: {base}')
        for name, value in expected.items():
            require(digest(base / name) == value, f'package payload changed: {base / name}')
        payloads += len(expected)
    for edge in supplemental['resolutionEdges']:
        require(str(Path(edge['logical']).resolve()) == edge['resolved'],
                f'installed dependency edge changed: {edge["logical"]}')
    for item in supplemental['uninstalledDeclaredOptionalOrPeerDependencies']:
        base = Path(item['from'])
        require(not any((ancestor / 'node_modules' / item['dependency']).exists()
                        for ancestor in [base, *base.parents]),
                f'previously absent optional/peer dependency appeared: {item["dependency"]}')
    recipe = read_json(HERE / 'run-recipe.json')
    proposal = read_json(binding['proposedCommand']['path'])
    require(recipe['executable'] == proposal['executable'] and
            recipe['cwd'] == proposal['workdir'] and
            recipe['argv'] == proposal['args'] + recipe['presentationArgs'],
            'exact proposed command/presentation adaptation changed')
    require(recipe['presentationArgs'] == ['--reporter=default', '--reporter=json',
            '--outputFile.json=' + recipe['expectedOutput']['path']], 'reporter adaptation changed')
    require(recipe['outerWallContainmentMs'] == 30000 and
            recipe['groupRssContainmentBytes'] == 1073741824, 'containment changed')
    require(recipe['environment'] == dict(proposal['environment'], CI='1', NO_COLOR='1'),
            'environment adaptation changed')
    require(recipe['maxWorkers'] == 1 and not recipe['fileParallelism'], 'concurrency changed')
    out = Path(recipe['outputDirectory'])
    for key in ['stdoutPath', 'stderrPath']:
        require(Path(recipe[key]).parent == out, 'log escaped exact output')
    require(Path(recipe['expectedOutput']['path']).parent == out, 'report escaped exact output')
    return binding, recipe, {'sourceFiles': 595, 'copiedSources': len(source['sourceCopies']),
                            'namedPackageRoots': len(seen), 'namedPackagePayloads': payloads,
                            'sourceFreezeSha256': binding['sourceFreeze']['sha256'],
                            'nodeSha256': source['node']['sha256']}


def load_supervisor(binding):
    item = binding['supervisor']
    require(digest(item['path']) == item['sha256'], 'supervisor changed before import')
    spec = importlib.util.spec_from_file_location('frozen_primary_pagination_supervisor', item['path'])
    supervisor = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(supervisor)  # Definitions only; original entry point is not invoked.
    return supervisor


def capture_report(recipe):
    path = Path(recipe['expectedOutput']['path'])
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and
            before.st_size <= 16777216, 'report is not a bounded fresh regular file')
    report = read_json(path)
    after = path.lstat()
    require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) ==
            (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns), 'report changed while reading')
    require(isinstance(report, dict) and isinstance(report.get('testResults'), list), 'invalid Vitest JSON report')
    selected = []
    executed = []
    for module in report['testResults']:
        for result in module.get('assertionResults', []):
            if result.get('status') not in ['pending', 'skipped', 'todo', 'disabled']:
                executed.append(result)
            if result.get('title') == recipe['expectedOutput']['title']:
                selected.append(result)
    require(len(selected) == 1 and len(executed) == 1 and selected[0] is executed[0],
            'report does not identify exactly the selected executed fixed campaign')
    require(selected[0].get('ancestorTitles') == recipe['expectedOutput']['ancestorTitles'],
            'selected campaign ancestry changed')
    return {'sha256': digest(path), 'bytes': before.st_size,
            'selectedStatus': selected[0].get('status'),
            'selectedFullName': selected[0].get('fullName'),
            'selectedTitle': selected[0].get('title'),
            'testResultFiles': len(report['testResults']),
            'reportSuccess': report.get('success'), 'productVerdict': 'UNCLASSIFIED'}


def execute(binding_sha):
    # All identities are checked before importing supervisor definitions,
    # creating runtime output, executing config/test code, or native probing.
    binding, recipe, identity = verify_inputs(binding_sha)
    supervisor = load_supervisor(binding)
    supervisor.UNSET = recipe['envUnset']
    supervisor.qualify_output = capture_report  # Supervision itself is unchanged.
    out = Path(recipe['outputDirectory'])
    out.mkdir(mode=0o700)  # Fixed, exclusive one-shot output; no automatic rerun.
    supervisor.sync_directory(out.parent)
    outer = {'bindingSha256': binding_sha, 'outerPid': os.getpid(), 'outerPgid': os.getpgrp(),
             'identityBefore': identity, 'identityAfter': None, 'command': recipe,
             'child': None, 'report': None, 'primaryFailure': None,
             'secondaryFailures': [], 'status': 'running', 'productVerdict': 'UNCLASSIFIED',
             'actualToolReturn': 'MUST BE RECORDED SEPARATELY BY CALLER'}
    previous_environment = dict(os.environ)
    try:
        for name in list(os.environ):
            if name.startswith(('H02_', 'VITEST_', 'TANSTACK_DB_ORACLE_')) or name in recipe['envUnset']:
                del os.environ[name]
        os.environ.update(recipe['environment'])
        outer['clearedEnvironmentNames'] = sorted(set(previous_environment) - set(os.environ))
        supervisor.durable_json(out / 'outer-pre.receipt.json', outer)
        for sig in [signal.SIGALRM, signal.SIGTERM, signal.SIGINT]:
            signal.signal(sig, supervisor.interrupted)
        state = supervisor.run_one(recipe, out, binding_sha)
        outer['child'] = state
        if state['primaryFailure'] is not None:
            supervisor.fail(outer, 'unchanged-supervisor-child-result', state['primaryFailure'])
        try:
            outer['report'] = capture_report(recipe)
        except BaseException as error:
            supervisor.fail(outer, 'report-capture', error)
        outer['identityAfter'] = verify_inputs(binding_sha)[2]
        require(outer['identityAfter'] == identity, 'source/tool identity changed during command')
        outer['status'] = 'child-zero-with-report' if outer['primaryFailure'] is None else 'stopped-nonzero'
    except BaseException as error:
        supervisor.fail(outer, 'outer', error)
        outer['status'] = 'stopped-nonzero'
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        os.environ.clear()
        os.environ.update(previous_environment)
        try:
            supervisor.durable_json(out / 'outer-final.receipt.json', outer)
        except BaseException as error:
            supervisor.fail(outer, 'outer-final-receipt', error)
            outer['status'] = 'stopped-nonzero'
            print(json.dumps(outer), file=sys.stderr)
    # An assertion exit1 stays child1/outer1. No expected-failure normalization.
    return 0 if outer['status'] == 'child-zero-with-report' else 1


if __name__ == '__main__':
    require(len(sys.argv) == 3 and sys.argv[1] == '--execute-exact-one',
            'Separate root admission required: --execute-exact-one <binding-sha256>')
    sys.exit(execute(sys.argv[2]))
