"""Calibration of benchmark selection validation and Linux resource accounting."""
import unittest
import re
from pathlib import Path
import subprocess
import tempfile
from unittest.mock import patch

from ci_browser_concurrency import (Process, Selection, WORKERS, compare,
                                    owned_processes, parse_process, validate_report, verify_source)


class SelectionTests(unittest.TestCase):
    def setUp(self):
        self.selection = Selection('selected', 'source.test.ts', 2, 5)
        self.report = dict(numPassedTests=2, numTotalTests=5, numFailedTests=0,
                           numPendingTests=3, numTodoTests=0, success=True)

    def test_exact_selection_passes(self):
        self.assertEqual(validate_report(self.report, self.selection), [])

    def test_empty_skipped_or_failed_work_cannot_report_success(self):
        for field, value in [('numPassedTests', 0), ('numTotalTests', 0),
                             ('numPendingTests', 4), ('numFailedTests', 1),
                             ('numTodoTests', 1), ('success', False),
                             ('numRuntimeErrorTestSuites', 1)]:
            report = {**self.report, field: value}
            with self.subTest(field=field):
                self.assertTrue(validate_report(report, self.selection))

    def test_decoder_selector_keeps_fixed_units_and_excludes_other_properties(self):
        pattern = WORKERS[0][0].pattern
        for title in [
            'adapter.powersync.batch-decode.chromium > fixed seed 2377: generated',
            'adapter.powersync.batch-decode.chromium > fixed seed 2377: generated eager:initial:valid 1',
        ]:
            self.assertIsNotNone(re.search(pattern, title), title)
        for title in [
            'adapter.powersync.batch-decode.chromium > random seed: generated',
            'adapter.powersync.batch-decode.mutations.chromium > fixed seed 2377: generated',
            'adapter.powersync.batch-decode.chromium > calibration: retains cleanup',
        ]:
            self.assertIsNone(re.search(pattern, title), title)

    def test_complete_peer_files_and_fixed_decode_selection_are_retained(self):
        self.assertEqual(sum(s.passed for q in WORKERS for s in q), 790)
        self.assertEqual(len({s.file for q in WORKERS for s in q}), 5)
        self.assertTrue(all(s.passed == s.total for s in WORKERS[1]))


class ResourceTests(unittest.TestCase):
    def test_stat_fields_preserve_parentheses_in_process_names(self):
        tail = ['S', '8', '9'] + ['0'] * 19
        tail[11], tail[12], tail[19], tail[21] = '13', '17', '1001', '7'
        item = parse_process('42 (chrome (worker)) ' + ' '.join(tail), 4096)
        self.assertEqual(item, Process(42, 8, 9, 1001, 'S', 7 * 4096, 30, 'chrome (worker)'))

    def test_owned_tree_includes_reparented_descendants_and_excludes_pid_reuse(self):
        rows = {
            2: Process(2, 1, 2, 10, 'S', 10, 0, 'pnpm'),
            3: Process(3, 2, 3, 11, 'S', 20, 0, 'node'),
            4: Process(4, 3, 4, 12, 'S', 30, 0, 'chrome'),
            5: Process(5, 1, 5, 13, 'S', 40, 0, 'chrome'),
            6: Process(6, 1, 6, 99, 'S', 50, 0, 'unrelated'),
        }
        owned = owned_processes(rows, {2}, {(5, 13), (6, 14)})
        self.assertEqual({p.pid for p in owned}, {2, 3, 4, 5})

    def test_contention_uses_both_complete_worker_queues(self):
        def phase(mode, durations, wall):
            return dict(mode=mode, workers=[[dict(seconds=s) for s in q] for q in durations],
                        work_seconds=wall, peak_sampled_rss_bytes=100, ok=True)
        phases = [phase('serial', [[10], [2, 3]], 15),
                  phase('parallel', [[11], [3, 4]], 11)]
        result = compare(phases)
        self.assertAlmostEqual(result['speedup'], 15 / 11)
        self.assertEqual(result['worker_slowdown_factors'], [1.1, 1.4])
        self.assertEqual(result['worst_worker_slowdown_factor'], 1.4)
        phases[1]['ok'] = False
        self.assertFalse(compare(phases)['ok'])


class SourceTests(unittest.TestCase):
    def test_dirty_sources_cannot_benchmark_a_clean_commit(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def git(*args):
                return subprocess.check_output(['git', *args], cwd=root, stderr=subprocess.DEVNULL, text=True).strip()
            git('init', '-q')
            (root / 'packages').mkdir()
            source = root / 'packages/source.ts'
            source.write_text('before\n')
            git('add', '.')
            git('-c', 'user.name=CI', '-c', 'user.email=ci@example.invalid', 'commit', '-qm', 'baseline')
            with patch.multiple('ci_browser_concurrency', ROOT=root, BASE=git('rev-parse', 'HEAD')):
                verify_source()
                source.write_text('after\n')
                with self.assertRaises(subprocess.CalledProcessError):
                    verify_source()
                source.write_text('before\n')
                (root / '.review-local').write_text('diagnostic\n')
                verify_source()


if __name__ == '__main__':
    unittest.main()
