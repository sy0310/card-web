import importlib.util
import unittest
from pathlib import Path


def load_fetch_ig_module():
    spec = importlib.util.spec_from_file_location("fetch_ig", Path("api/fetch_ig.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class CookieJar:
    def __init__(self):
        self.values = {}

    def set(self, key, value):
        self.values[key] = value


class Session:
    def __init__(self):
        self.cookies = CookieJar()


class FakeMedia:
    media_type = 1
    thumbnail_url = "https://cdn.example.test/card.jpg"
    caption_text = "#megurotxt temptation $12"


class BaseFakeClient:
    last_instance = None

    def __init__(self):
        self.settings = {}
        self.private = Session()
        self.public = Session()
        self.calls = []
        self.proxy = None
        self.authorization_data = None
        type(self).last_instance = self

    def set_proxy(self, proxy):
        self.proxy = proxy

    def media_pk_from_code(self, code):
        self.calls.append(("media_pk_from_code", code))
        return "123456789"

    def init(self):
        self.calls.append(("init", dict(self.settings)))

    def login_by_sessionid(self, _session_id):
        raise AssertionError("fetch_instagram_media must not validate login by session id")


class PublicSuccessClient(BaseFakeClient):
    def media_info_gql(self, media_pk):
        self.calls.append(("media_info_gql", media_pk))
        return FakeMedia()

    def media_info_a1(self, _media_pk):
        raise AssertionError("public GraphQL success should stop fallback attempts")

    def media_info(self, _media_pk, use_cache=True):
        raise AssertionError("public GraphQL success should not use private media lookup")


class SessionFallbackClient(BaseFakeClient):
    def media_info_gql(self, _media_pk):
        raise RuntimeError("400 Client Error for url: https://www.instagram.com/graphql/query/?variables=secret")

    def media_info_a1(self, _media_pk):
        raise RuntimeError("403 Client Error for url: https://i.instagram.com/api/v1/users/123/info/")

    def media_info(self, media_pk, use_cache=True):
        self.calls.append(("media_info", media_pk, use_cache))
        return FakeMedia()


class BadCodeClient(BaseFakeClient):
    def media_pk_from_code(self, code):
        self.calls.append(("media_pk_from_code", code))
        raise ValueError("bad shortcode")


class AllLookupFailClient(BaseFakeClient):
    def media_info_gql(self, _media_pk):
        raise RuntimeError(
            "401 Client Error: Unauthorized for url: "
            "https://www.instagram.com/graphql/query/?variables=secret"
        )

    def media_info_a1(self, _media_pk):
        raise RuntimeError(
            "404 Client Error: Not Found for url: "
            "https://www.instagram.com/p/DZUe_8NTT1G/?__a=1&__d=dis"
        )

    def media_info(self, media_pk, use_cache=True):
        self.calls.append(("media_info", media_pk, use_cache))
        raise RuntimeError("login_required")


class SavedSettingsFallbackClient(SessionFallbackClient):
    def set_settings(self, settings):
        self.calls.append(("set_settings", settings))
        self.settings.update(settings)


class LegacyRetryClient:
    def __init__(self):
        self.request_timeout = None
        self.public_request_retries_count = 3

    def set_retry_config(self, **_kwargs):
        raise TypeError("unexpected keyword argument")


class FetchInstagramMediaTest(unittest.TestCase):
    def setUp(self):
        self.module = load_fetch_ig_module()

    def test_public_lookup_does_not_require_session(self):
        result = self.module.fetch_instagram_media(
            "ABC123_def",
            session_id=None,
            proxy=None,
            client_factory=PublicSuccessClient,
        )

        self.assertEqual(
            result,
            {
                "success": True,
                "caption": "#megurotxt temptation $12",
                "imageUrl": "https://cdn.example.test/card.jpg",
            },
        )
        self.assertEqual(
            PublicSuccessClient.last_instance.calls,
            [("media_pk_from_code", "ABC123_def"), ("media_info_gql", "123456789")],
        )

    def test_session_fallback_does_not_call_login_by_sessionid(self):
        result = self.module.fetch_instagram_media(
            "ABC123_def",
            session_id="2935954956%3Along-session-value",
            proxy="http://proxy.example.test:8080",
            client_factory=SessionFallbackClient,
        )

        client = SessionFallbackClient.last_instance
        self.assertEqual(result["imageUrl"], "https://cdn.example.test/card.jpg")
        self.assertEqual(client.proxy, "http://proxy.example.test:8080")
        self.assertEqual(client.settings["cookies"], {"sessionid": "2935954956%3Along-session-value"})
        self.assertEqual(client.private.cookies.values["ds_user_id"], "2935954956")
        self.assertEqual(client.public.cookies.values["sessionid"], "2935954956%3Along-session-value")
        self.assertEqual(
            client.calls[-1],
            ("media_info", "123456789", False),
        )

    def test_client_startup_errors_return_diagnostic_code(self):
        def broken_client_factory():
            raise ImportError("No module named instagrapi")

        with self.assertRaises(self.module.InstagramSyncError) as ctx:
            self.module.fetch_instagram_media(
                "ABC123_def",
                client_factory=broken_client_factory,
            )

        self.assertEqual(ctx.exception.code, "instagram_client_start_failed")
        self.assertIn("ImportError", ctx.exception.detail)
        self.assertIn("instagrapi", ctx.exception.to_payload()["detail"])

    def test_shortcode_decode_errors_are_not_reported_as_unexpected(self):
        with self.assertRaises(self.module.InstagramSyncError) as ctx:
            self.module.fetch_instagram_media(
                "ABC123_def",
                client_factory=BadCodeClient,
            )

        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(ctx.exception.code, "invalid_media_code")
        self.assertIn("bad shortcode", ctx.exception.detail)

    def test_client_retry_configuration_supports_legacy_instagrapi(self):
        client = LegacyRetryClient()

        self.module._configure_instagram_client(client, 1.5)

        self.assertEqual(client.request_timeout, 1.5)
        self.assertEqual(client.public_request_retries_count, 1)

    def test_lookup_blocked_errors_are_sanitized_and_actionable(self):
        with self.assertRaises(self.module.InstagramSyncError) as ctx:
            self.module.fetch_instagram_media(
                "DZUe_8NTT1G",
                session_id="2935954956%3Along-session-value",
                client_factory=AllLookupFailClient,
            )

        self.assertEqual(ctx.exception.status_code, 502)
        self.assertEqual(ctx.exception.code, "instagram_lookup_blocked")
        self.assertTrue(ctx.exception.retryable)
        self.assertIn("Refresh the Instagram session", str(ctx.exception))
        self.assertIn("Instagram GraphQL endpoint", ctx.exception.detail)
        self.assertIn("Instagram public media endpoint", ctx.exception.detail)
        self.assertNotIn("https://www.instagram.com", ctx.exception.detail)
        self.assertNotIn("DZUe_8NTT1G", ctx.exception.detail)

    def test_saved_settings_can_power_private_fallback_without_session_id(self):
        result = self.module.fetch_instagram_media(
            "ABC123_def",
            session_id=None,
            settings_json='{"cookies": {"sessionid": "saved-session"}}',
            client_factory=SavedSettingsFallbackClient,
        )

        client = SavedSettingsFallbackClient.last_instance
        self.assertEqual(result["imageUrl"], "https://cdn.example.test/card.jpg")
        self.assertEqual(client.calls[-2][0], "set_settings")
        self.assertEqual(client.calls[-1], ("media_info", "123456789", False))


if __name__ == "__main__":
    unittest.main()
