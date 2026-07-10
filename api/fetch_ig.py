from http.server import BaseHTTPRequestHandler
import json
import hashlib
import hmac
import os
import re
import sys
import traceback
from urllib.parse import urlencode
from urllib.request import Request, urlopen

# Load local .env.local values as fallback for development
try:
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    scripts_dir = os.path.join(base_dir, 'src', 'scripts')
    if os.path.exists(scripts_dir):
        sys.path.append(scripts_dir)
        from publish_ig_env import load_publish_env
        env = load_publish_env(os.path.join(base_dir, '.env.local'))
        for k, v in env.items():
            k_clean = k.strip()
            # Don't overwrite existing environment variables
            if k_clean and not os.environ.get(k_clean):
                os.environ[k_clean] = v.strip()
except Exception as e:
    # Fail silently, e.g. when running in Vercel production
    pass

MEDIA_CODE_RE = re.compile(r"^[A-Za-z0-9_-]{5,}$")
SESSION_USER_ID_RE = re.compile(r"^\d+")


class InstagramSyncError(Exception):
    def __init__(self, message, status_code=500, code="instagram_sync_failed", retryable=False, detail=None):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.retryable = retryable
        self.detail = detail

    def to_payload(self):
        payload = {
            "error": str(self),
            "code": self.code,
            "retryable": self.retryable,
        }
        if self.detail:
            payload["detail"] = self.detail
        return payload


def _new_client():
    from instagrapi import Client

    public_transport = os.environ.get("IG_PUBLIC_TRANSPORT", "curl").strip()
    if public_transport and public_transport.lower() != "requests":
        client_kwargs = {
            "public_transport": public_transport,
            "public_transport_impersonate": os.environ.get("IG_PUBLIC_TRANSPORT_IMPERSONATE", "chrome136"),
        }
        try:
            client = Client(**client_kwargs)
        except Exception as exc:
            print(
                "Instagram curl public transport unavailable; falling back to requests: "
                f"{_summarize_exception(exc)}",
                file=sys.stderr,
            )
            client = Client()
    else:
        client = Client()

    request_delay = _float_env("IG_REQUEST_DELAY_SECONDS", 1.0)
    _configure_instagram_client(client, request_delay)
    return client


def _configure_instagram_client(client, request_delay):
    try:
        client.set_retry_config(request_timeout=request_delay, public_request_retries_count=1)
        return
    except (AttributeError, TypeError):
        pass

    client.request_timeout = request_delay
    if hasattr(client, "public_request_retries_count"):
        client.public_request_retries_count = 1


def _float_env(key, default):
    value = os.environ.get(key)
    if not value:
        return default
    try:
        return float(value)
    except ValueError:
        return default


def _environment_runtime_settings():
    return {
        "session_id": (
            os.environ.get("session_id")
            or os.environ.get("SESSION_ID")
            or os.environ.get("INSTAGRAM_SESSION_ID")
        ),
        "settings_json": (
            os.environ.get("INSTAGRAM_SETTINGS_JSON")
            or os.environ.get("IG_SETTINGS_JSON")
        ),
        "settings_file": (
            os.environ.get("INSTAGRAM_SETTINGS_FILE")
            or os.environ.get("IG_SETTINGS_FILE")
        ),
        "proxy": (
            os.environ.get("proxy")
            or os.environ.get("PROXY")
            or os.environ.get("HTTPS_PROXY")
            or os.environ.get("HTTP_PROXY")
        ),
    }


def _load_database_runtime_settings():
    """Read the latest server-only Instagram settings from Supabase.

    The Python function runs separately from the Next.js server, so it cannot
    reuse the Node Supabase client. It uses the service-role REST endpoint when
    configured and returns an empty dict on any infrastructure error, allowing
    the environment fallback to keep working during rollout.
    """
    supabase_url = (os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip().rstrip("/")
    service_role_key = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not supabase_url or not service_role_key:
        return {}

    query = urlencode({
        "select": "session_id,settings_json,proxy",
        "order": "updated_at.desc",
        "limit": "1",
    })
    request = Request(
        f"{supabase_url}/rest/v1/instagram_settings?{query}",
        headers={
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Accept": "application/json",
        },
        method="GET",
    )

    try:
        with urlopen(request, timeout=5) as response:
            rows = json.loads(response.read().decode("utf-8"))
        if not isinstance(rows, list) or not rows:
            return {}

        row = rows[0]
        if not isinstance(row, dict):
            return {}

        settings_json = row.get("settings_json")
        if isinstance(settings_json, (dict, list)):
            settings_json = json.dumps(settings_json)

        return {
            "session_id": row.get("session_id") or None,
            "settings_json": settings_json or None,
            "proxy": row.get("proxy") or None,
        }
    except Exception:
        # Do not log response bodies or credentials. The caller will use env
        # values, which preserves the pre-migration behavior.
        print(
            "Instagram database settings lookup failed; using environment fallback.",
            file=sys.stderr,
        )
        return {}


def get_instagram_runtime_settings():
    environment_settings = _environment_runtime_settings()
    database_settings = _load_database_runtime_settings()
    return {
        key: database_settings.get(key) or environment_settings.get(key)
        for key in environment_settings
    }


def _has_valid_internal_secret(headers):
    service_role_key = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    provided_secret = headers.get("X-Instagram-Internal-Secret", "")
    if not service_role_key or not provided_secret:
        return False

    expected_secret = hashlib.sha256(
        f"{service_role_key}:instagram-fetch".encode("utf-8")
    ).hexdigest()
    return hmac.compare_digest(provided_secret, expected_secret)


def _summarize_exception(exc):
    message = str(exc).strip().replace("\n", " ")
    message = re.sub(r"https://www\.instagram\.com/graphql/query/\?\S+", "Instagram GraphQL endpoint", message)
    message = re.sub(r"https://i\.instagram\.com/api/v1/\S+", "Instagram private API endpoint", message)
    message = re.sub(
        r"https://www\.instagram\.com/(?:p|reel|tv)/[A-Za-z0-9_-]+/\?\S+",
        "Instagram public media endpoint",
        message,
    )
    message = re.sub(
        r"https://www\.instagram\.com/(?:p|reel|tv)/[A-Za-z0-9_-]+/?",
        "Instagram public media endpoint",
        message,
    )
    if len(message) > 240:
        message = message[:237] + "..."
    return f"{exc.__class__.__name__}: {message}" if message else exc.__class__.__name__


def _apply_saved_settings(client, settings_json=None, settings_file=None):
    settings_json = settings_json or os.environ.get("INSTAGRAM_SETTINGS_JSON") or os.environ.get("IG_SETTINGS_JSON")
    settings_file = settings_file or os.environ.get("INSTAGRAM_SETTINGS_FILE") or os.environ.get("IG_SETTINGS_FILE")

    if settings_json:
        try:
            settings = json.loads(settings_json) if isinstance(settings_json, str) else settings_json
        except Exception as exc:
            raise InstagramSyncError(
                "Configured Instagram saved settings JSON is invalid.",
                status_code=500,
                code="invalid_instagram_settings",
                detail=_summarize_exception(exc),
            )
        _set_client_settings(client, settings)
        return True

    if settings_file:
        try:
            if hasattr(client, "load_settings"):
                settings = client.load_settings(settings_file)
            else:
                with open(settings_file, "r", encoding="utf-8") as fh:
                    settings = json.load(fh)
        except Exception as exc:
            raise InstagramSyncError(
                "Configured Instagram saved settings file could not be loaded.",
                status_code=500,
                code="invalid_instagram_settings",
                detail=_summarize_exception(exc),
            )
        _set_client_settings(client, settings)
        return True

    return False


def test_instagram_connection(
    session_id=None,
    proxy=None,
    settings_json=None,
    settings_file=None,
    client_factory=_new_client,
):
    try:
        client = client_factory()
    except Exception as exc:
        detail = _summarize_exception(exc)
        raise InstagramSyncError(
            "Instagram sync client failed to start.",
            status_code=500,
            code="instagram_client_start_failed",
            detail=detail,
        )

    if proxy:
        try:
            client.set_proxy(proxy)
        except Exception as exc:
            raise InstagramSyncError(
                "Configured Instagram proxy is invalid.",
                status_code=500,
                code="instagram_proxy_invalid",
                detail=_summarize_exception(exc),
            )

    has_saved_settings = _apply_saved_settings(
        client,
        settings_json=settings_json,
        settings_file=settings_file,
    )
    if not has_saved_settings and not session_id:
        raise InstagramSyncError(
            "Instagram session is not configured.",
            status_code=500,
            code="instagram_session_missing",
        )

    if not has_saved_settings:
        _attach_session_without_validation(client, session_id)

    try:
        account = client.account_info()
    except Exception as exc:
        detail = _summarize_exception(exc)
        raise InstagramSyncError(
            "Instagram connection failed. Refresh the session or saved settings.",
            status_code=502,
            code="instagram_connection_failed",
            retryable=True,
            detail=detail,
        )

    username = getattr(account, "username", None)
    return {
        "success": True,
        "username": str(username) if username else None,
    }


def _set_client_settings(client, settings):
    if hasattr(client, "set_settings"):
        client.set_settings(settings)
        return
    if isinstance(settings, dict):
        client.settings.update(settings)


def _iter_public_media_fetchers(client):
    for method_name in ("media_info_gql", "media_info_a1"):
        method = getattr(client, method_name, None)
        if callable(method):
            yield method_name, method


def _iter_authenticated_media_fetchers(client):
    for method_name in ("media_info_v1", "media_info_v2"):
        method = getattr(client, method_name, None)
        if callable(method):
            yield method_name, method

    media_info = getattr(client, "media_info", None)
    if callable(media_info):
        yield "media_info", lambda media_pk: media_info(media_pk, use_cache=False)


def _try_media_fetchers(media_pk, fetchers, failures):
    for name, fetch_media in fetchers:
        try:
            return _media_payload(fetch_media(media_pk))
        except Exception as exc:
            failures.append(f"{name}: {_summarize_exception(exc)}")
    return None


def _lookup_blocked_message(failures):
    joined = " | ".join(failures).lower()
    if any(token in joined for token in ("loginrequired", "login_required", "unauthorized", "401")):
        return (
            "Instagram refused the lookup. Refresh the Instagram session or saved settings, "
            "and make sure the configured proxy can access Instagram."
        )
    if any(token in joined for token in ("notfound", "not found", "404", "media not found")):
        return (
            "Instagram could not find this post or reel. Check that the link is public, "
            "still available, and copied from the original Instagram page."
        )
    return (
        "Instagram refused the post lookup. Refresh the Instagram session and check that "
        "the configured proxy can access Instagram."
    )


def _attach_session_without_validation(client, session_id):
    user_match = SESSION_USER_ID_RE.search(session_id or "")
    if not user_match:
        raise InstagramSyncError(
            "Configured Instagram session_id is malformed. Refresh it from the logged-in Instagram account.",
            status_code=500,
            code="invalid_instagram_session",
        )

    user_id = user_match.group()
    client.settings["cookies"] = {"sessionid": session_id}
    client.init()
    client.authorization_data = {
        "ds_user_id": user_id,
        "sessionid": session_id,
        "should_use_header_over_cookies": True,
    }
    client.private.cookies.set("ds_user_id", user_id)
    client.public.cookies.set("sessionid", session_id)
    client.public.cookies.set("ds_user_id", user_id)


def _first_image_url(media):
    if getattr(media, "media_type", None) == 8 and getattr(media, "resources", None):
        image_url = getattr(media.resources[0], "thumbnail_url", None)
        if image_url:
            return str(image_url)
    image_url = getattr(media, "thumbnail_url", None)
    return str(image_url) if image_url else None


def _media_payload(media):
    image_url = _first_image_url(media)
    if not image_url:
        raise InstagramSyncError(
            "No valid image URL found on the Instagram post.",
            status_code=502,
            code="instagram_image_missing",
            retryable=True,
        )

    return {
        "success": True,
        "caption": getattr(media, "caption_text", None) or "",
        "imageUrl": image_url,
    }


def fetch_instagram_media(
    media_code,
    session_id=None,
    proxy=None,
    settings_json=None,
    settings_file=None,
    client_factory=_new_client,
):
    if not media_code or not MEDIA_CODE_RE.match(media_code):
        raise InstagramSyncError("Invalid Instagram media code.", status_code=400, code="invalid_media_code")

    try:
        client = client_factory()
    except Exception as exc:
        detail = _summarize_exception(exc)
        print(f"Instagram client startup failed: {detail}\n{traceback.format_exc()}", file=sys.stderr)
        raise InstagramSyncError(
            "Instagram sync client failed to start.",
            status_code=500,
            code="instagram_client_start_failed",
            detail=detail,
        )

    if proxy:
        try:
            client.set_proxy(proxy)
        except Exception as exc:
            detail = _summarize_exception(exc)
            print(f"Instagram proxy setup failed: {detail}", file=sys.stderr)
            raise InstagramSyncError(
                "Configured Instagram proxy is invalid.",
                status_code=500,
                code="instagram_proxy_invalid",
                detail=detail,
            )

    try:
        media_pk = client.media_pk_from_code(media_code)
    except Exception as exc:
        detail = _summarize_exception(exc)
        print(f"Instagram shortcode decode failed: {detail}", file=sys.stderr)
        raise InstagramSyncError(
            "Invalid Instagram shortcode. Please paste the original Instagram post/reel URL.",
            status_code=400,
            code="invalid_media_code",
            detail=detail,
        )

    failures = []

    public_result = _try_media_fetchers(media_pk, _iter_public_media_fetchers(client), failures)
    if public_result:
        return public_result

    has_saved_settings = _apply_saved_settings(client, settings_json=settings_json, settings_file=settings_file)
    if has_saved_settings and proxy:
        client.set_proxy(proxy)

    if not has_saved_settings and not session_id:
        raise InstagramSyncError(
            "Instagram public post lookup was blocked and session_id is not configured.",
            status_code=500,
            code="instagram_session_missing",
        )

    if not has_saved_settings:
        _attach_session_without_validation(client, session_id)

    authenticated_result = _try_media_fetchers(media_pk, _iter_authenticated_media_fetchers(client), failures)
    if authenticated_result:
        return authenticated_result

    print("Instagram sync attempts failed: " + " | ".join(failures), file=sys.stderr)
    raise InstagramSyncError(
        _lookup_blocked_message(failures),
        status_code=502,
        code="instagram_lookup_blocked",
        retryable=True,
        detail=" | ".join(failures),
    )


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            if not _has_valid_internal_secret(self.headers):
                self._send_json({'error': 'Instagram sync service is not publicly accessible.'}, 401)
                return

            # 1. Read request body
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))
            
            media_code = data.get('mediaCode')
            runtime_settings = get_instagram_runtime_settings()

            if data.get("action") == "testConnection":
                res_data = test_instagram_connection(
                    session_id=runtime_settings.get("session_id"),
                    proxy=runtime_settings.get("proxy"),
                    settings_json=runtime_settings.get("settings_json"),
                    settings_file=runtime_settings.get("settings_file"),
                )
                self._send_json(res_data, 200)
                return

            if not media_code:
                self._send_json({'error': 'Missing mediaCode'}, 400)
                return

            res_data = fetch_instagram_media(
                media_code,
                session_id=runtime_settings.get("session_id"),
                proxy=runtime_settings.get("proxy"),
                settings_json=runtime_settings.get("settings_json"),
                settings_file=runtime_settings.get("settings_file"),
            )
            self._send_json(res_data, 200)

        except InstagramSyncError as e:
            self._send_json(e.to_payload(), e.status_code)
        except Exception as e:
            detail = _summarize_exception(e)
            print(f"Unexpected Instagram sync error: {detail}\n{traceback.format_exc()}", file=sys.stderr)
            self._send_json(
                {
                    'error': f'Instagram sync failed unexpectedly: {detail}',
                    'code': 'instagram_sync_unexpected_error',
                    'detail': detail,
                },
                500,
            )

    def _send_json(self, data, status_code):
        self.send_response(status_code)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))
