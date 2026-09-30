import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "llamacpp-and-nvidia"))

# Keep the import side-effect free: avoid creating a token file in tests.
os.environ.setdefault("GPU_STATS_TOKEN", "test-token")
os.environ.setdefault("GPU_STATS_TOKEN_PATH", str(Path(__file__).resolve().parent / "_unused.token"))

import gpu_llamacpp_server as server  # noqa: E402


class ParseMetricsTest(unittest.TestCase):
    def test_extracts_counters_and_gauges(self):
        text = (
            "# HELP llamacpp:tokens_predicted_total Number of generation tokens processed\n"
            "# TYPE llamacpp:tokens_predicted_total counter\n"
            "llamacpp:tokens_predicted_total 4983\n"
            "llamacpp:predicted_tokens_seconds 41.2259\n"
            "llamacpp:requests_processing 0\n"
        )
        metrics = server.parse_metrics(text)
        self.assertEqual(metrics["llamacpp:tokens_predicted_total"], 4983.0)
        self.assertEqual(metrics["llamacpp:predicted_tokens_seconds"], 41.2259)
        self.assertEqual(metrics["llamacpp:requests_processing"], 0.0)

    def test_strips_labels(self):
        text = 'llamacpp:foo{slot="0",state="busy"} 3.5\n'
        self.assertEqual(server.parse_metrics(text)["llamacpp:foo"], 3.5)

    def test_ignores_comments_and_malformed(self):
        self.assertEqual(server.parse_metrics("# comment\nnot a metric\n"), {})


class RecordPerformanceTest(unittest.TestCase):
    def setUp(self):
        server.MODEL_PERFORMANCE.clear()

    def test_first_sample(self):
        server._record_performance("m", 10.0)
        row = server.MODEL_PERFORMANCE["m"]
        self.assertEqual(row["current_tokens_per_second"], 10.0)
        self.assertEqual(row["max_tokens_per_second"], 10.0)
        self.assertEqual(row["average_tokens_per_second"], 10.0)
        self.assertEqual(row["sample_count"], 1)
        self.assertIn("updated_at", row)

    def test_running_average_and_max(self):
        server._record_performance("m", 10.0)
        server._record_performance("m", 20.0)
        row = server.MODEL_PERFORMANCE["m"]
        self.assertEqual(row["current_tokens_per_second"], 20.0)
        self.assertEqual(row["max_tokens_per_second"], 20.0)
        self.assertAlmostEqual(row["average_tokens_per_second"], 15.0)
        self.assertEqual(row["sample_count"], 2)

    def test_average_and_max_over_three(self):
        for speed in (10.0, 20.0, 40.0):
            server._record_performance("m", speed)
        row = server.MODEL_PERFORMANCE["m"]
        self.assertAlmostEqual(row["average_tokens_per_second"], (10 + 20 + 40) / 3)
        self.assertEqual(row["max_tokens_per_second"], 40.0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
