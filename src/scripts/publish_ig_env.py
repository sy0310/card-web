import os
from pathlib import Path


def _parse_env_file(env_path):
    values = {}
    path = Path(env_path)
    if not path.exists():
        return values

    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("'").strip('"')

    return values


def _first_value(*values):
    for value in values:
        if value:
            return value
    return None


def load_publish_env(env_path=".env.local", environ=None):
    environment = os.environ if environ is None else environ
    file_env = _parse_env_file(env_path)

    return {
        "session_id": _first_value(
            environment.get("session_id"),
            environment.get("SESSION_ID"),
            environment.get("INSTAGRAM_SESSION_ID"),
            file_env.get("session_id"),
            file_env.get("SESSION_ID"),
            file_env.get("INSTAGRAM_SESSION_ID"),
        ),
        "proxy": _first_value(
            environment.get("proxy"),
            environment.get("PROXY"),
            environment.get("HTTPS_PROXY"),
            environment.get("HTTP_PROXY"),
            file_env.get("proxy"),
            file_env.get("PROXY"),
            file_env.get("HTTPS_PROXY"),
            file_env.get("HTTP_PROXY"),
        ),
    }
