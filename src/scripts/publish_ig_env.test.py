import tempfile
import unittest
from pathlib import Path

from publish_ig_env import load_publish_env


class PublishIgEnvTest(unittest.TestCase):
    def test_environment_values_override_env_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            env_file = Path(tmpdir) / ".env.local"
            env_file.write_text(
                "session_id=from-file\nproxy=http://file-proxy\n",
                encoding="utf-8",
            )

            env = load_publish_env(
                env_file,
                {
                    "session_id": "from-env",
                    "proxy": "http://env-proxy",
                },
            )

        self.assertEqual(env["session_id"], "from-env")
        self.assertEqual(env["proxy"], "http://env-proxy")

    def test_env_file_is_used_as_local_fallback(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            env_file = Path(tmpdir) / ".env.local"
            env_file.write_text(
                "session_id='from-file'\nproxy=\"http://file-proxy\"\n",
                encoding="utf-8",
            )

            env = load_publish_env(env_file, {})

        self.assertEqual(env["session_id"], "from-file")
        self.assertEqual(env["proxy"], "http://file-proxy")


if __name__ == "__main__":
    unittest.main()
