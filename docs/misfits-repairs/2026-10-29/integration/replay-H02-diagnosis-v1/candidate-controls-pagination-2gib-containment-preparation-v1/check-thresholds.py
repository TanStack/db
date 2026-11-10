"""Pure source and integer-boundary checks; no supervisor import or process API."""
import ast
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
OLD = Path('/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-h02-metadata-receiving-v1/docs/misfits-metadata-receiving-native-list-launcher-v1/launch.py')
OLD_SHA = '9566ec6fe9fdace272d8e204e3a8c86e407f8da50f4ffc11f7d5961bdd07cfb2'
OLD_LIMIT = 1073741824
NEW_LIMIT = 2147483648


def main():
    original = OLD.read_bytes()
    successor = (HERE / 'supervisor-2gib.py').read_bytes()
    assert hashlib.sha256(original).hexdigest() == OLD_SHA
    assert original.count(b'1073741824') == 2
    assert original.count(b'1 GiB sampled group RSS containment') == 1
    assert successor == original.replace(b'1073741824', b'2147483648').replace(
        b'1 GiB sampled group RSS containment', b'2 GiB sampled group RSS containment')
    tree = ast.parse(successor)
    checks = [node.args[0] for node in ast.walk(tree)
              if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
              and node.func.id == 'require' and node.args
              and isinstance(node.args[0], ast.Compare)
              and isinstance(node.args[0].left, ast.Name)
              and node.args[0].left.id == 'rss']
    assert len(checks) == 1
    condition = checks[0]
    assert len(condition.ops) == 1 and isinstance(condition.ops[0], ast.LtE)
    assert len(condition.comparators) == 1
    assert isinstance(condition.comparators[0], ast.Constant)
    assert condition.comparators[0].value == NEW_LIMIT
    expression = compile(ast.Expression(condition), '<exact parsed RSS predicate>', 'eval')
    cases = []
    for value, expected in [(0, True), (OLD_LIMIT, True), (OLD_LIMIT + 1, True),
                            (NEW_LIMIT - 1, True), (NEW_LIMIT, True),
                            (NEW_LIMIT + 1, False), (3 * OLD_LIMIT, False)]:
        observed = eval(expression, {'__builtins__': {}}, {'rss': value})
        assert observed is expected
        cases.append({'rssBytes': value, 'allowed': observed})
    # Calibration of the allowance only: restoring the old integer fails the
    # newly allowed old-limit+1 case. This is not a product-mutant experiment.
    assert not (OLD_LIMIT + 1 <= OLD_LIMIT)
    result = {'status': 'PASS pure exact-source and threshold checks',
              'originalSha256': OLD_SHA,
              'successorSha256': hashlib.sha256(successor).hexdigest(),
              'exactIntegerSubstitutions': 2, 'exactDiagnosticSubstitutions': 1,
              'allOtherBytesIdentical': True, 'cases': cases,
              'oldThresholdSensitivity': 'old-limit+1 would be incorrectly rejected',
              'nativeCalibration': False, 'supervisorImported': False,
              'processCalls': 0, 'runtimeAdmitted': False}
    with (HERE / 'pure-boundary-results-v1.json').open('x') as output:
        json.dump(result, output, indent=2)
        output.write('\n')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
