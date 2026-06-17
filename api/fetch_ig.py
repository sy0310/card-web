from http.server import BaseHTTPRequestHandler
import json
import os
import re
import sys
import traceback

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

    request_delay = _float_env("IG_REQUEST_DELAY_SECONDS", 1.0)
    return Client(request_timeout=request_delay, public_request_retries_count=1)


def _float_env(key, default):
    value = os.environ.get(key)
    if not value:
        return default
    try:
        return float(value)
    except ValueError:
        return default


def _summarize_exception(exc):
    message = str(exc).strip().replace("\n", " ")
    message = re.sub(r"https://www\.instagram\.com/graphql/query/\?\S+", "Instagram GraphQL endpoint", message)
    message = re.sub(r"https://i\.instagram\.com/api/v1/\S+", "Instagram private API endpoint", message)
    if len(message) > 240:
        message = message[:237] + "..."
    return f"{exc.__class__.__name__}: {message}" if message else exc.__class__.__name__


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


def fetch_instagram_media(media_code, session_id=None, proxy=None, client_factory=_new_client):
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

    for fetch_media in (client.media_info_gql, client.media_info_a1):
        try:
            return _media_payload(fetch_media(media_pk))
        except Exception as exc:
            failures.append(_summarize_exception(exc))

    if not session_id:
        raise InstagramSyncError(
            "Instagram public post lookup was blocked and session_id is not configured.",
            status_code=500,
            code="instagram_session_missing",
        )

    _attach_session_without_validation(client, session_id)
    try:
        return _media_payload(client.media_info(media_pk, use_cache=False))
    except Exception as exc:
        failures.append(_summarize_exception(exc))
        print("Instagram sync attempts failed: " + " | ".join(failures), file=sys.stderr)
        raise InstagramSyncError(
            "Instagram refused the post lookup. Refresh the Instagram session_id and check that the configured proxy can access Instagram.",
            status_code=502,
            code="instagram_lookup_blocked",
            retryable=True,
            detail=" | ".join(failures),
        )


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            # 1. Read request body
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))
            
            media_code = data.get('mediaCode')
            if not media_code:
                self._send_json({'error': 'Missing mediaCode'}, 400)
                return
            
            # 2. Get credentials from environment
            session_id = os.environ.get('session_id') or os.environ.get('SESSION_ID') or os.environ.get('INSTAGRAM_SESSION_ID')
            proxy = os.environ.get('proxy') or os.environ.get('PROXY') or os.environ.get('HTTPS_PROXY') or os.environ.get('HTTP_PROXY')

            res_data = fetch_instagram_media(media_code, session_id=session_id, proxy=proxy)
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
