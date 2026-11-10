"""Read/hash/JSON/source audit only. No imports of bound programs, test/model/product execution, or process probes."""
import datetime
import hashlib
import json
import os
import pathlib

O = pathlib.Path(__file__).resolve().parent
H = O.parent
R = H / 'candidate-controls-pagination-failed-peer-primary-red-runtime-v1'
C = H / 'candidate-controls-pagination-failed-peer-containment-preparation-v1'
P = H / 'candidate-controls-pagination-failed-peer-source-preparation-v1'
errors = []

def sha(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()

def load(path):
    def pairs(items):
        value = {}
        for key, item in items:
            if key in value:
                raise ValueError('duplicate JSON key: ' + key)
            value[key] = item
        return value
    return json.loads(pathlib.Path(path).read_text(), object_pairs_hook=pairs)

def check(value, message):
    if not value:
        errors.append(message)

def mapped(root, entries, label, permit_drift=False):
    drift = []
    total_bytes = 0
    for name, value in entries.items():
        expected = value['sha256'] if isinstance(value, dict) else value
        path = pathlib.Path(root) / name
        try:
            content = path.read_bytes()
            actual = hashlib.sha256(content).hexdigest()
            total_bytes += len(content)
            if actual != expected:
                drift.append({'path': str(path), 'expected': expected, 'actual': actual})
            if isinstance(value, dict):
                check(len(content) == value['bytes'], label + ': bytes ' + name)
        except OSError as error:
            drift.append({'path': str(path), 'expected': expected, 'error': str(error)})
    if not permit_drift:
        check(not drift, label + ': hash mismatch')
    return {'files': len(entries), 'bytes': total_bytes, 'drift': drift}

known = {
    R / 'result-freeze-v1.json': '6a3df64c714d54542e8c2cda8ea3b5def9b5c2ef8c35652d2e452ce5463c7d9d',
    C / 'packet-manifest.json': '81ad3dffafeb7d9f2975d9e15ab1d01cfbef50ad9687cac5bfc0ba4c9f6e4cd3',
    C / 'binding.json': '73f288a87255d58095b431942fb94aa4d65b6d75508acd55d2f89a7e6ed44db7',
    C / 'root-primary-red-admission-v1.json': 'bced374c51614dbd911257589df9bec8a2bc58bb3be7bd6928c46c5d04966a87',
    C / 'launch.py': '8cae808cd8b045c45e78c10ca492ce0f8f712a6ea2d64a61ada28ee0aae7d4b0',
    C / 'run-recipe.json': '6a290c3a8e4a03382e026c39b09b71196bcc39aa9d7a2003253709ea3b2d8dc3',
    C / 'supplemental-tool-inputs.json': 'cd7eda6b0e649cb2aa019b83dac04f7821d52e34d0c62de144ac6d280636ba50',
    P / 'packet-sha256-v1.json': '2a6e992f2e25fa4dcbfb05456924bfb597bd583a59234a8b445b95a139773a75',
    P / 'source-freeze-v1.json': 'cf550f0a80c400acb8a151f58f5692ba3f1442dc5122027b42b2160f76179eec',
    O / 'pagination-failed-peer-source-independent-review-v1.md': 'fa564e2739de52a397e8cea07aa7edc12ac8125c2869673b8a341ab5fd273e07',
    O / 'inline-source-failed-peer-checkpoint-actual-independent-review-v1.md': 'd41d903daef37da930046d1f7b21e896edf959d7545207dc7496d4df59e3a96c',
    O / 'inline-source-failed-peer-checkpoint-actual-independent-facts-v2.json': 'ecc54f059aa9e133cc974aa73662ac2b8eaff3814016440c74f327f1684fbbe9',
}
observed = {}
for path, expected in known.items():
    observed[str(path)] = sha(path)
    check(observed[str(path)] == expected, 'known identity: ' + str(path))

freeze = load(R / 'result-freeze-v1.json')
result_assets = mapped(R, freeze['files'], 'frozen result')
check(result_assets['files'] == freeze['fileCount'] == 13, '13 result files')
check(result_assets['bytes'] == freeze['totalBytes'] == 37846, '37846 result bytes')
absent_reports = {name: not os.path.lexists(R / name) for name in freeze['expectedAbsentFiles']}
check(absent_reports == {'vitest-report.json': True}, 'expected report absence')
check(set(path.name for path in R.iterdir()) == set(freeze['files']) | {'result-freeze-v1.json'}, 'frozen directory has exactly 13 assets plus manifest')
check(freeze['actualInvocations'] == 1 and not freeze['retryOrProgression'], 'one frozen invocation')
packet = load(C / 'packet-manifest.json')
containment_members = mapped(C, packet['members'], 'containment packet')
check(containment_members['files'] == 7, 'seven containment packet members')
source_packet = mapped(P, load(P / 'packet-sha256-v1.json'), 'source packet')
check(source_packet['files'] == 105, '105 source packet members')
binding = load(C / 'binding.json')
admission = load(C / 'root-primary-red-admission-v1.json')
recipe = load(C / 'run-recipe.json')
source = load(P / 'source-freeze-v1.json')
supplemental = load(C / 'supplemental-tool-inputs.json')
W = pathlib.Path(source['worktree'])
for key in ['supervisor', 'proposedCommand', 'sourceFreeze', 'ps']:
    item = binding[key]
    observed[item['path']] = sha(item['path'])
    check(observed[item['path']] == item['sha256'], 'bound ' + key)
for name, expected in binding['files'].items():
    check(sha(C / name) == expected, 'binding member ' + name)
for key in ['python']:
    item = binding[key]
    check(sha(item['executable']) == item['sha256'], 'bound ' + key)
check(sha(source['node']['executable']) == source['node']['sha256'], 'bound Node')
for relative, expected in [('pnpm-lock.yaml', source['lockfiles']['repoPnpmLock']), ('node_modules/.pnpm/lock.yaml', source['lockfiles']['installedPnpmLock'])]:
    check(sha(W / relative) == expected, 'bound lock ' + relative)
for relative, item in source['dependencyReuseLinks'].items():
    path = W / relative
    check(path.is_symlink() == item['isSymlink'] and str(path.resolve()) == item['resolved'], 'reuse link ' + relative)
check(len(source['dependencyReuseLinks']) == 4, 'four reuse links')

# Current live drift is separate from the immutable historical before/after/post receipts.
current_sources = mapped(W, source['sourceBindings'], 'current sources', permit_drift=True)
source_copies = mapped(source['sourceCopyRoot'], source['sourceCopies'], 'source copies')
check(current_sources['files'] == 595 and source_copies['files'] == 84, '595 sources / 84 copies')
check(len(source['productionFiles']) == source['productionCount'] == 511, '511 production bindings')

def payload_names(base):
    names = set()
    for directory, directories, files in os.walk(base, followlinks=False):
        directories[:] = [name for name in directories if name != 'node_modules' and not (pathlib.Path(directory) / name).is_symlink()]
        for name in files:
            path = pathlib.Path(directory) / name
            if path.is_file() and not path.is_symlink():
                names.add(str(path.relative_to(base)))
    return names

seen = {}
payload_bytes = 0
payload_count = 0
source_packages = list(source['packages'].values())
supplemental_packages = supplemental['packages']
check(len(source_packages) == 9 and len(supplemental_packages) == supplemental['packageRoots'] == 253, '9 + 253 package declarations')
check(sum(len(item['regularPayloadFilesMap']) for item in source_packages) == 2544, '2544 source package payload entries')
check(sum(len(item['regularPayloadFilesMap']) for item in supplemental_packages) == supplemental['regularPayloadFiles'] == 11241, '11241 supplemental payload entries')
for item in source_packages + supplemental_packages:
    logical = pathlib.Path(item['logical'])
    if not logical.is_absolute():
        logical = W / logical
    check(str(logical.resolve()) == item['resolved'], 'package resolution ' + str(logical))
    base = pathlib.Path(item['resolved'])
    files = item['regularPayloadFilesMap']
    if str(base) in seen:
        check(seen[str(base)] == files, 'duplicate package map agrees ' + str(base))
        continue
    seen[str(base)] = files
    check(payload_names(base) == set(files), 'package own payload file set ' + str(base))
    actual = mapped(base, files, 'package own payload ' + str(base))
    payload_count += actual['files']
    payload_bytes += actual['bytes']
check(len(seen) == 255 and payload_count == 11974, '255 unique roots / 11974 own payloads')
for edge in supplemental['resolutionEdges']:
    check(str(pathlib.Path(edge['logical']).resolve()) == edge['resolved'], 'resolution edge ' + edge['logical'])
for item in supplemental['uninstalledDeclaredOptionalOrPeerDependencies']:
    base = pathlib.Path(item['from'])
    check(not any((ancestor / 'node_modules' / item['dependency']).exists() for ancestor in [base, *base.parents]), 'absent optional/peer ' + item['dependency'])
check(len(supplemental['resolutionEdges']) == 405 and len(supplemental['uninstalledDeclaredOptionalOrPeerDependencies']) == 112, '405 edges / 112 absent optional or peer checks')

proposal = load(binding['proposedCommand']['path'])
check(recipe['executable'] == proposal['executable'] and recipe['cwd'] == proposal['workdir'] and recipe['argv'] == proposal['args'] + recipe['presentationArgs'], 'recipe exact proposed command plus reporters')
check(recipe['presentationArgs'] == ['--reporter=default', '--reporter=json', '--outputFile.json=' + str(R / 'vitest-report.json')], 'exact reporter adaptation')
check(recipe['campaign'] == {'seed': 1665, 'runs': 8, 'familySchedules': ['failure-first', 'peer-first', 'success'], 'noOtherCampaignAdmitted': True}, 'seed1665 / eight / three schedules')
check(recipe['environment'] == dict(proposal['environment'], CI='1', NO_COLOR='1'), 'exact environment adaptation')
check(recipe['maxWorkers'] == 1 and recipe['fileParallelism'] is False and recipe['outerWallContainmentMs'] == 30000 and recipe['groupRssContainmentBytes'] == 1073741824, 'fixed concurrency and operational limits')
check(admission['admittedBy'] == '/root' and admission['executor'] == '/root/native_shutdown_receiving' and admission['reservedHeavySlot'] == 2 and admission['admittedRuntime'] is True and admission['maxInvocations'] == 1, 'root admitted exact one in slot2')
for field, path in [('packetManifestSha256', C / 'packet-manifest.json'), ('bindingSha256', C / 'binding.json'), ('launcherSha256', C / 'launch.py'), ('recipeSha256', C / 'run-recipe.json'), ('sourceFreezeSha256', P / 'source-freeze-v1.json')]:
    check(admission[field] == sha(path), 'admission identity ' + field)

actual = load(R / 'actual-tool-return-v1.json')
check(actual['admissionSha256'] == sha(C / 'root-primary-red-admission-v1.json'), 'actual root admission identity')
expected_command = binding['python']['executable'] + ' -I -B ' + str(C / 'launch.py') + ' --execute-exact-one ' + sha(C / 'binding.json')
check(actual['command'] == expected_command, 'actual exact outer command')
check(actual['actualInvocationPermission'] == 'sandbox_permissions=require_escalated', 'actual elevated launcher permission')
check(actual['initial']['chunk_id'] == '46d907' and actual['initial']['session_id'] == 31238 and actual['actualCompletion']['chunk_id'] == '5a6619' and actual['actualCompletion']['exit_code'] == actual['actualOuterExitCode'] == 1, 'actual session / final outer1')
check(actual['maxInvocations'] == 1 and not actual['retryAuthorized'] and not actual['progressionAuthorized'], 'actual no retry/progression authorization')

receipt_names = ['00-pre-spawn.receipt.json', '00-spawn.receipt.json', '00-group-verified.receipt.json', '00-failure.receipt.json', '00-final.receipt.json']
receipts = [load(R / name) for name in receipt_names]
pre, spawn, verified, failure, final = receipts
chronology = [item['elapsedMs'] for item in receipts]
check(chronology == [0, 3, 3, 1681, 1744], 'saved receipt chronology')
for item in receipts:
    check(item['argv'] == [recipe['executable']] + recipe['argv'] and item['cwd'] == recipe['cwd'], 'receipt argv / cwd ' + item['phase'])
    check(item['bindingSha256'] == sha(C / 'binding.json') and item['envUnset'] == recipe['envUnset'] and item['envSet'] == {'CI': '1', 'NO_COLOR': '1'}, 'receipt binding/environment ' + item['phase'])
check(pre['pid'] is None and pre['pgid'] is None and not pre['pgidVerified'], 'pre-spawn has no PID')
check(spawn['pid'] == spawn['pgid'] == 73353 and not spawn['pgidVerified'], 'spawn original PID/PGID')
check(verified['pid'] == verified['pgid'] == 73353 and verified['pgidVerified'], 'positive original PGID verification')
rss_rows = failure['remainingGroupRows']
rss_sum = sum(item['rssBytes'] for item in rss_rows if item['pgid'] == failure['pgid'])
check(rss_rows == [{'pgid': 73353, 'pid': 73353, 'rssBytes': 488865792, 'stat': 'Rs'}, {'pgid': 73353, 'pid': 73356, 'rssBytes': 31391744, 'stat': 'S'}, {'pgid': 73353, 'pid': 73361, 'rssBytes': 571195392, 'stat': 'S'}], 'three original-group RSS rows')
check(rss_sum == failure['maxSampledGroupRssBytes'] == final['maxSampledGroupRssBytes'] == 1091452928 and rss_sum > recipe['groupRssContainmentBytes'], 'RSS sum exceeds operational limit')
resource_failure = {'phase': 'native-list', 'error': '1 GiB sampled group RSS containment'}
check(failure['primaryFailure'] == final['primaryFailure'] == resource_failure and failure['killAttempts'] == [] and failure['samples'] == final['samples'] == 13, 'failure precedes cleanup;13 samples')
check(final['killAttempts'] == [{'result': 'sent', 'signal': 'SIGKILL', 'targetPgid': 73353}] and final['exitCode'] == -9 and final['remainingGroupRows'] == [] and final['secondaryFailures'] == [], 'known verified group SIGKILL / reaped leader / final absence')
outer_pre = load(R / 'outer-pre.receipt.json')
outer = load(R / 'outer-final.receipt.json')
post = load(R / 'post-return-source-tool-identity-v1.json')
absence = load(R / 'post-return-process-absence-v1.json')
expected_identity = {'sourceFiles': 595, 'copiedSources': 84, 'namedPackageRoots': 255, 'namedPackagePayloads': 11974, 'sourceFreezeSha256': sha(P / 'source-freeze-v1.json'), 'nodeSha256': source['node']['sha256']}
check(outer_pre['identityBefore'] == outer['identityBefore'] == outer['identityAfter'] == post['identity'] == expected_identity, 'saved before / after / separate post identities equal')
check(post['status'] == 'PASS' and post['wrapperBeforeAfterAndSeparatePostReturnEqual'] is True and post['same595Sources84Copies255PackageRoots11974Payloads405Edges112AbsentOptionalOrPeersVerified'] is True and post['esbuildControlNamesPresent'] == [], 'saved separate post source/tool PASS and esbuild controls absent')
check(not post['runtimeConfigOrTestReimported'] and not post['supervisorReimported'] and not post['newNativeInvocation'], 'saved postcheck no reimport or native launch')
check(outer['command'] == outer_pre['command'] == recipe and outer['outerPid'] == outer['outerPgid'] == outer_pre['outerPid'] == outer_pre['outerPgid'] == 73331, 'outer command and PID/PGID')
check({key: value for key, value in final.items() if key not in ['phase', 'bindingSha256']} == outer['child'], 'outer child exactly final receipt state')
check(outer['status'] == 'stopped-nonzero' and outer['productVerdict'] == 'UNCLASSIFIED' and outer['report'] is None, 'outer operational classification no report')
check(outer['primaryFailure'] == {'phase': 'unchanged-supervisor-child-result', 'error': str(resource_failure)}, 'outer propagates first RSS cause')
check(len(outer['secondaryFailures']) == 1 and outer['secondaryFailures'][0]['phase'] == 'report-capture' and 'No such file or directory' in outer['secondaryFailures'][0]['error'], 'missing report secondary only')
check(absence['actualProbePermission'] == 'require_escalated' and absence['psExitCode'] == 0 and absence['psStderr'] == '' and absence['remainingNamedRows'] == [], 'saved separate post absence probe')
check(absence['namedOriginalPids'] == absence['namedOriginalGroups'] == [73331, 73353], 'saved named original identities')
check(absence['zeroSignalProbes'] == [{'kind': kind, 'value': value, 'result': 'ESRCH'} for kind in ['pid', 'pgid'] for value in [73331, 73353]], 'four saved ESRCH observations')

wrapper_text = (C / 'launch.py').read_text()
supervisor_path = pathlib.Path(binding['supervisor']['path'])
supervisor_text = supervisor_path.read_text()
run_one = supervisor_text[supervisor_text.index('def run_one('):supervisor_text.index('\ndef ', supervisor_text.index('def run_one(') + 1)]
check('start_new_session=True' in run_one and 'actual = os.getpgid(child.pid)' in run_one and "require(actual == child.pid" in run_one, 'bound supervisor creates/verifies original group')
check(run_one.index("require(rss <= 1073741824") < run_one.index('if child.poll() is not None:'), 'sampled RSS check precedes child poll')
check(run_one.index("receipt('failure')") < run_one.index('finally:'), 'failure receipt before final cleanup')
check('os.killpg(state[\'pgid\'], signal.SIGKILL)' in run_one and 'child.wait(timeout=3)' in run_one and "require(not state['remainingGroupRows']" in run_one, 'bound original group cleanup / reap / final inventory')
check('supervisor.UNSET = recipe[\'envUnset\']' in wrapper_text and 'supervisor.qualify_output = capture_report' in wrapper_text and "state = supervisor.run_one(recipe, out, binding_sha)" in wrapper_text, 'wrapper configures qualifier and UNSET; calls original run_one')

plugin = next(item for item in supplemental_packages if item['name'] == 'vite-tsconfig-paths')
plugin_path = pathlib.Path(plugin['resolved']) / 'dist/index.js'
plugin_hash = sha(plugin_path)
plugin_text = plugin_path.read_text()
plugin_lines = plugin_text.splitlines(keepends=True)
check(plugin_hash == plugin['regularPayloadFilesMap']['dist/index.js'] == '78c7739176947b8e012ef3afc2e8c7c233fc21ee96a7fcf493e5178829c0ffb7', 'bound installed plugin source')
scan = ''.join(plugin_lines[60:94])
catch = ''.join(plugin_lines[122:137])
skip = ''.join(plugin_lines[140:145])
check('searchForWorkspaceRoot(projectRoot)' in scan and 'tsconfck.findAll(workspaceRoot' in scan, 'workspace config scan')
check('.catch((error) => {' in catch and 'config.logger.error(' in catch and 'console.error(error)' in catch and 'firstError = error' in catch and 'return null;' in catch and 'throw ' not in catch, 'parse failure is logged/caught and returns null')
check('if (!project)' in skip and 'return;' in skip and plugin_text.count('firstError') == 3, 'null config projects skipped; firstError only logging state')
stdout = (R / 'stdout.log').read_text()
stderr = (R / 'stderr.log').read_text()
check('RUN  v4.1.12' in stdout and 'Coverage enabled with istanbul' in stdout, 'saved runner / Istanbul banners')
check(stderr.count('[tsconfig-paths] An error occurred while parsing') == 2 and stderr.count('TSConfckParseError: failed to resolve "extends":"expo/tsconfig.base"') == 2, 'two caught Expo parse diagnostics')
check('examples/react-native/shopping-list/tsconfig.json' in stderr and 'examples/react-native/offline-transactions/tsconfig.json' in stderr, 'both scanned example config paths')
check('Testing types with tsc and vue-tsc is an experimental feature.' in stderr and 'AssertionError' not in stderr and 'pagination joined-window-failure callback checkpoint' not in stdout + stderr, 'only described diagnostics; no intended assertion/checkpoint retained')

ledger = O / 'raw-items-ledger-v1.jsonl'
ledger_before = ledger.read_bytes()
check(hashlib.sha256(ledger_before).hexdigest() == '6e72a0032f89f054e5286a3de20f8edc5de8cf403a287e1e8c9f2c0c0371a224', '102-row received ledger prefix')
check(len(ledger_before.splitlines()) == 102, '102 received ledger rows')
facts = {
    'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'mode': __doc__, 'knownIdentities': observed,
    'resultAssets': result_assets, 'expectedReportAbsent': absent_reports,
    'containmentMembers': containment_members, 'sourcePacket': source_packet,
    'currentSourcesAtIndependentAudit': current_sources, 'immutableSourceCopies': source_copies,
    'currentSourceDriftInterpretation': 'Any drift is current successor work, separate from the immutable saved positive before/after/post identity; no historical result is inferred solely from current files.',
    'dependencyChecks': {'sourcePackages': 9, 'supplementalPackages': 253, 'uniqueRoots': len(seen), 'uniqueOwnPayloadFiles': payload_count, 'uniqueOwnPayloadBytesRead': payload_bytes, 'resolutionEdges': 405, 'absentDeclaredOptionalOrPeers': 112, 'node': 1, 'python': 1, 'psBinary': 1, 'locks': 2, 'reuseLinks': 4},
    'actualInvocation': actual, 'nativeRecipe': recipe, 'receiptChronologyMs': dict(zip(receipt_names, chronology)),
    'RSS': {'sampleSumBytes': rss_sum, 'limitBytes': 1073741824, 'excessBytes': rss_sum - 1073741824, 'sampleCount': 13, 'failureAtMs': 1681, 'finalAtMs': 1744, 'rows': rss_rows, 'roles': 'Not inferred: these rows do not retain process commands.'},
    'cleanup': {'originalChildPidPgid': 73353, 'outerPidPgid': 73331, 'killAttempts': final['killAttempts'], 'childExit': final['exitCode'], 'finalOriginalGroupRows': final['remainingGroupRows'], 'savedSeparatePostAbsence': absence, 'limit': 'Named original PID/PGID observations only; no escaped/unregistered census or reuse proof; no validation of separate inner completion-supervisor kill path.'},
    'savedIdentity': {'beforeAfterAndSeparatePost': expected_identity, 'separatePostReceipt': post, 'bindingLimitation': 'Disk/source/tool checks and saved receipts only; no V8/evaluated-source binding claimed.'},
    'expoDiagnosis': {'plugin': str(plugin_path), 'pluginSha256': plugin_hash, 'workspaceScanLines': [61, 94], 'caughtParseLines': [123, 137], 'nullProjectSkipLines': [141, 145], 'spanSha256': {'scan61to94': hashlib.sha256(scan.encode()).hexdigest(), 'catch123to137': hashlib.sha256(catch.encode()).hexdigest(), 'skip141to145': hashlib.sha256(skip.encode()).hexdigest()}, 'conclusion': 'Caught workspace configuration-scan parse errors. This path logs and returns null, then skips those projects. The retained output does not establish an independent fatal Expo setup stop or prove all later setup succeeds.'},
    'qualification': 'OPERATIONAL RSS CONTAINMENT. No product RED/GREEN, mutant rejection, assertion or reach credit.',
    'bodyExecution': 'UNESTABLISHED: no selected-test JSON/report, reach diagnostic, callback comparison or intended assertion retained. Missing evidence does not establish zero body execution.',
    'rawTimestampCorrection': 'Received ledger summary associates RSS with1744ms; immutable failure receipt records1681ms, and final receipt1744ms. Raw ledger text preserved.',
    'sourceOrderReview': {'immutable13assets/raw': 'rehash PASS', 'exact actual command/permission/oneinvocation': 'PASS against saved record', 'RSSkill chronology and sampledsum': 'PASS; failure1681ms/final1744ms', 'ownedcleanup/namedabsence limit': 'PASS within named identities only', 'bindings/sourcepost equality': 'saved positive before/after/post retained; current audit separately recorded', 'Expo diagnostic fatality': 'caught scan diagnostics; independent fatal setup not established', 'absence report/test/reach evidence': 'no product or reach credit', 'preserved earlier first-callback-only RED and allUNREACHEDlimits': 'preserved without expanding it'},
    'preservedLimits': {'priorFirstCallbackRed': 'Only earlier inline-source-failed-peer first callback raw301/boundary286 normalizeddelivery302; later raw321/flush-throw/pending operation contaminated follow-on.', 'candidateRaw20': 'all UNREACHED; no credit transferred', 'actualHelperNoActiveOperation': 'required and UNREACHED', 'state14': 'proposed/unadopted', 'metadata': 'separate owner', 'primaryReceiving': 'rich full-child shared QueryClient receiving required before production edits', 'peerLivePremise': 'Controlled experiment premise; no law forbidding lawful retirement', 'replay': 'explicit -t selecting new random/replayed family required'},
    'auditProductExecutions': 0, 'auditModelExecutions': 0, 'auditTestExecutions': 0, 'auditNativeRunInvocations': 0, 'auditProcessProbes': 0,
    'ledgerPrefix': {'rows': 102, 'sha256': hashlib.sha256(ledger_before).hexdigest()},
    'errors': errors, 'allAuditChecksPass': not errors,
}
path = O / 'pagination-failed-peer-rss-actual-independent-facts-v1.json'
path.write_text(json.dumps(facts, indent=2) + '\n')
print(json.dumps({'facts': str(path), 'factsSha256': sha(path), 'resultAssets': result_assets['files'], 'resultBytes': result_assets['bytes'], 'sourcePacket': source_packet['files'], 'currentSourceDriftCount': len(current_sources['drift']), 'uniquePackageRoots': len(seen), 'uniquePayloadFiles': payload_count, 'errors': errors}))
raise SystemExit(1 if errors else 0)
