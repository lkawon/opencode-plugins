import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import sync_llamacpp_context as sync  # noqa: E402


class StripJsoncTest(unittest.TestCase):
    def test_removes_line_comments(self):
        result = sync.strip_jsonc('{"a": 1} // done\n')
        self.assertNotIn("//", result)
        self.assertEqual(json.loads(result), {"a": 1})

    def test_removes_block_comments(self):
        result = sync.strip_jsonc('{"a": 1, /* x */ "b": 2}')
        self.assertNotIn("/*", result)
        self.assertEqual(json.loads(result), {"a": 1, "b": 2})

    def test_removes_trailing_commas(self):
        result = sync.strip_jsonc('{"a": [1, 2,]}')
        self.assertEqual(json.loads(result), {"a": [1, 2]})

    def test_preserves_slashes_in_strings(self):
        text = '{"url": "https://example.com/a/b"}'
        self.assertEqual(sync.strip_jsonc(text), text)


class SynchronizeTest(unittest.TestCase):
    def _config(self):
        return {
            "provider": {
                "llamacpp": {
                    "models": {
                        "qwen3.8-27b": {
                            "name": "Qwen",
                            "limit": {"context": 1000, "input": 1000, "output": 8192},
                        }
                    }
                }
            }
        }

    def _limit(self, config):
        return config["provider"]["llamacpp"]["models"]["qwen3.8-27b"]["limit"]

    def test_updates_limits(self):
        config = self._config()
        changes, skipped = sync.synchronize(config, [{"identifier": "qwen3.8-27b", "contextLength": 152576}], 8192)
        limit = self._limit(config)
        self.assertEqual(limit["context"], 152576)
        self.assertEqual(limit["input"], 152576)
        self.assertEqual(limit["output"], 8192)
        self.assertEqual(len(changes), 1)
        self.assertEqual(skipped, [])

    def test_skips_unknown_model(self):
        config = self._config()
        changes, skipped = sync.synchronize(config, [{"identifier": "other", "contextLength": 5000}], 8192)
        self.assertEqual(changes, [])
        self.assertEqual(skipped, ["other"])

    def test_output_reserve_clamped_to_context_minus_one(self):
        config = self._config()
        sync.synchronize(config, [{"identifier": "qwen3.8-27b", "contextLength": 100}], 8192)
        self.assertEqual(self._limit(config)["output"], 99)

    def test_no_change_when_synced(self):
        config = self._config()
        self._limit(config).update({"context": 16000, "input": 16000, "output": 8192})
        changes, skipped = sync.synchronize(config, [{"identifier": "qwen3.8-27b", "contextLength": 16000}], 8192)
        self.assertEqual(changes, [])
        self.assertEqual(skipped, [])

    def test_missing_provider_skips_model(self):
        changes, skipped = sync.synchronize({}, [{"identifier": "m", "contextLength": 100}], 8192)
        self.assertEqual(changes, [])
        self.assertEqual(skipped, ["m"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
