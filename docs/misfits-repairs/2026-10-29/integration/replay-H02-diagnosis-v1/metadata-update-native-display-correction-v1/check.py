"""Read-only requalification of captured native display bytes, never a launcher.

The original wrapper exit1/native child0 and its name failure stay unchanged.
Only four expected display strings change from quarter 0 to quarter +0.
"""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import stat

HERE = Path(__file__).resolve().parent
H = HERE.parent
PREP = H / 'metadata-update-native-preparation-v1'
OLD_BINDING = 'f76ca819782079460124aa2fba14dc203362e5c3a03a435a5d7d30bbdab4ba65'
RESULT_SHA = '6c2794c3b81b56cb2501013dc07e9cf9740f576bc6c06d8db7580a035ea01bb6'


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def gate():
    require(digest(PREP / 'binding.json') == OLD_BINDING, 'original binding changed')
    binding = json.loads((PREP / 'binding.json').read_text())
    require(digest(PREP / 'verify.py') == binding['files']['verify.py'], 'original verifier changed before import')
    spec = importlib.util.spec_from_file_location('preserved_metadata_source_gate', PREP / 'verify.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def verify(binding_sha):
    require(digest(HERE / 'binding.json') == binding_sha, 'display-correction binding changed')
    binding = json.loads((HERE / 'binding.json').read_text())
    for name, expected in binding['files'].items():
        require(Path(name).name == name and digest(HERE / name) == expected, 'display-correction input changed')
    g = gate()
    original_recipes, identity = g.verify_inputs(OLD_BINDING)
    result_path = H / 'metadata-update-native-discovery-result-freeze-v1.json'
    require(digest(result_path) == RESULT_SHA, 'original actual-result freeze changed')
    result = g.read(result_path)
    out = Path(result['outputDirectory'])
    require(out == H / 'metadata-update-native-discovery-v1' and
            result['bindingSha256'] == OLD_BINDING and result['sourceFreezeSha256'] == g.SOURCE_SHA,
            'captured result epoch changed')
    require({p.name for p in out.iterdir()} == set(result['assets']) and len(result['assets']) == 10,
            'captured raw output set changed')
    for name, expected in result['assets'].items():
        path = out / name
        require(Path(name).name == name and stat.S_ISREG(path.lstat().st_mode) and
                path.stat().st_nlink == 1 and digest(path) == expected, 'captured raw output changed')
    for suffix, key in [('root-outer-return', 'actualOuterReturnSha256'), ('root-absence', 'rootAbsenceSha256'),
                        ('source-recheck', 'sourceRecheckSha256'), ('name-difference', 'nameDifferenceSha256')]:
        require(digest(H / f'metadata-update-native-discovery-{suffix}-v1.json') == result[key],
                f'captured {suffix} changed')
    require(digest(PREP / 'root-universe-admission-v1.json') == result['rootAdmissionSha256'], 'original admission changed')
    outer = g.read(out / 'outer-final.receipt.json')
    child = g.read(out / '00-final.receipt.json')
    actual = g.read(H / 'metadata-update-native-discovery-root-outer-return-v1.json')
    require(actual['actualOuterExitCode'] == actual['completionToolReturn']['exit_code'] == 1 and
            outer['status'] == 'stopped' and child['exitCode'] == 0 and
            child['primaryFailure'] == {'phase': 'native-list', 'error': 'wrong native list names'} and
            child['secondaryFailures'] == [] and child['killAttempts'] == [] and
            child['pgidVerified'] is True and child['remainingGroupRows'] == [] and
            outer['secondaryFailures'] == [] and outer['identityBefore'] == outer['identityAfter'] == identity,
            'original stopped outer1/child0 or fresh source identity changed')
    absence = g.read(H / 'metadata-update-native-discovery-root-absence-v1.json')
    require([(p['participant'], p['kind'], p['identity'], p['status']) for p in absence['probes']] ==
            [('outer', 'pid', outer['outerPid'], 'empty-ESRCH'), ('outer', 'pgid', outer['outerPgid'], 'empty-ESRCH'),
             ('child', 'pid', child['pid'], 'empty-ESRCH'), ('child', 'pgid', child['pgid'], 'empty-ESRCH')],
            'original identity absence changed')
    original = original_recipes['universe']
    corrected = g.read(HERE / 'corrected-universe-recipe.json')
    expected = copy.deepcopy(original)
    expected['expectedOutput']['names'] = [name[:-1] + '+0' if name.endswith('quarter 0') else name
                                         for name in original['expectedOutput']['names']]
    require(corrected == expected and sum(a != b for a, b in zip(original['expectedOutput']['names'],
            corrected['expectedOutput']['names'])) == 4, 'correction must change only four no-op display strings')
    supervisor = g.supervisor()
    try:
        supervisor.qualify_output(original)
    except ValueError as error:
        require(str(error) == 'wrong native list names', 'old captured-name RED has another cause')
    else:
        raise ValueError('old expected-name check did not reject captured native bytes')
    qualified = supervisor.qualify_output(corrected)
    return {'status': 'CAPTURED DISPLAY REQUALIFICATION ONLY; original stop preserved; no new native run',
            'correctionBindingSha256': binding_sha, 'originalBindingSha256': OLD_BINDING,
            'originalResultFreezeSha256': RESULT_SHA, 'sourceFreezeSha256': g.SOURCE_SHA,
            'originalObservedOuterExitCode': 1, 'originalNativeChildExitCode': 0,
            'originalStopPreserved': True, 'oldExpectedNamesRejected': 'wrong native list names',
            'correctedDisplayQualification': qualified, 'freshInputIdentity': identity,
            'filterSelectionCredit': False, 'testPassCredit': False, 'receivingReachCredit': False,
            'productRedGreenCredit': False, 'newRuntimeAdmitted': False, 'nativeLaunches': 0, 'nativeProcessProbes': 0}


if __name__ == '__main__':
    import sys
    require(len(sys.argv) == 2, 'Expected exact correction binding SHA256; this is not a launcher')
    print(json.dumps(verify(sys.argv[1]), indent=2, sort_keys=True))
