"""Offline checks of HTTP transport behavior and credential boundaries."""

from email.message import Message
import io
import json
import os
import socket
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib import error, request, response

import pages_http


class FakeHTTPS(request.BaseHandler):
    handler_order = 100

    def __init__(self, status=200, body=b'{"data": []}', location=None, failure=None):
        self.status, self.body, self.location, self.failure = status, body, location, failure
        self.requests = []

    def https_open(self, req):
        self.requests.append(req)
        if self.failure:
            raise self.failure
        headers = Message()
        headers["Content-Type"] = "application/json"
        if self.location:
            headers["Location"] = self.location
        result = response.addinfourl(io.BytesIO(self.body), headers, req.full_url, self.status)
        result.msg = "Test response"
        return result


class HTTPClientTests(unittest.TestCase):
    def send(self, transport, method="GET", path="/api/verified-collection", **kwargs):
        original = request.build_opener
        with patch.object(request, "build_opener", side_effect=lambda *handlers: original(transport, *handlers)):
            return pages_http.perform(method, path, token="test-only-bearer", **kwargs)

    def test_authenticated_json_write_and_unicode_query(self):
        transport = FakeHTTPS(201, b'{"data": {"documentId": "abc123"}}')
        payload = {"data": {"title": "Тест"}}
        result = self.send(transport, "POST", body=payload, queries=[("status", "draft"), ("filters[slug][$eq]", "тест")])
        sent = transport.requests[0]
        self.assertTrue(result["ok"])
        self.assertEqual(sent.get_header("Authorization"), "Bearer test-only-bearer")
        self.assertEqual(json.loads(sent.data), payload)
        self.assertIn("status=draft", sent.full_url)
        self.assertIn("filters%5Bslug%5D%5B%24eq%5D=", sent.full_url)

    def test_public_read_never_sends_a_token(self):
        transport = FakeHTTPS(body=b'<html>Pages</html>')
        result = self.send(transport, path="/", public=True)
        self.assertTrue(result["ok"])
        self.assertIsNone(transport.requests[0].get_header("Authorization"))

    def test_redirects_are_not_followed_even_with_a_token(self):
        for location in ("https://other.invalid/leak", "https://pages.live4.dev/other"):
            transport = FakeHTTPS(302, location=location)
            result = self.send(transport)
            self.assertEqual(result["error"], "redirect_refused")
            self.assertEqual(len(transport.requests), 1)

    def test_failed_write_is_not_retried_and_is_marked_uncertain(self):
        transport = FakeHTTPS(failure=error.URLError("connection reset"))
        result = self.send(transport, "POST", body={"data": {"title": "Test"}})
        self.assertEqual(len(transport.requests), 1)
        self.assertEqual(result["mutation_outcome"], "unknown")

    def test_server_error_and_unreadable_success_are_uncertain_writes(self):
        for transport in (FakeHTTPS(500), FakeHTTPS(201, b'<html>unexpected</html>')):
            result = self.send(transport, "POST", body={"data": {"title": "Test"}})
            self.assertFalse(result["ok"])
            self.assertEqual(result["mutation_outcome"], "unknown")
            self.assertEqual(len(transport.requests), 1)

    def test_empty_delete_response_is_successful(self):
        result = self.send(FakeHTTPS(204, b""), "DELETE", "/api/verified-collection/abc123")
        self.assertTrue(result["ok"])
        self.assertIsNone(result["body"])

    def test_api_html_error_does_not_dump_the_response(self):
        result = self.send(FakeHTTPS(403, b'<html>private error details</html>'))
        self.assertFalse(result["ok"])
        self.assertNotIn("private error details", json.dumps(result))

    def test_known_token_and_secret_fields_are_redacted(self):
        body = json.dumps({"error": {"message": "echo test-only-bearer", "access_token": "another-secret"}, "test-only-bearer": "reflected key"}).encode()
        result = self.send(FakeHTTPS(401, body))
        output = json.dumps(result)
        self.assertNotIn("test-only-bearer", output)
        self.assertNotIn("another-secret", output)
        self.assertEqual(result["http_status"], 401)

    def test_network_errors_are_classified_without_echoing_details(self):
        cases = (
            (error.URLError(socket.gaierror(socket.EAI_NONAME, "private detail")), "dns_error"),
            (error.URLError(PermissionError("private detail")), "network_permission_denied"),
            (TimeoutError("private detail"), "request_timeout"),
        )
        for failure, expected in cases:
            result = self.send(FakeHTTPS(failure=failure))
            self.assertEqual(result["error"], expected)
            self.assertNotIn("private detail", json.dumps(result))

    def test_external_and_traversing_paths_fail_before_transport(self):
        for path in ("https://other.invalid/api", "//other.invalid/api", "/api/../admin", "/api/%252e%252e/admin", "/api/\\admin", "/api/x?token=x"):
            with self.subTest(path=path), patch.object(request, "build_opener") as opener:
                with self.assertRaises(pages_http.ClientError):
                    pages_http.perform("GET", path, token="test-only")
                opener.assert_not_called()

    def test_public_writes_fail_before_transport(self):
        with patch.object(request, "build_opener") as opener:
            with self.assertRaises(pages_http.ClientError):
                pages_http.perform("POST", "/api/verified-collection", public=True, body={"data": {}})
            opener.assert_not_called()

    def test_token_file_permissions_and_no_value_in_errors(self):
        with tempfile.TemporaryDirectory(dir=os.environ.get("PAGES_TEST_TMPDIR")) as directory:
            filename = Path(directory) / "test-token"
            filename.write_text("test-only-bearer\n")
            filename.chmod(0o600)
            self.assertEqual(pages_http.read_token({"PAGES_API_TOKEN_FILE": str(filename)}), "test-only-bearer")
            filename.chmod(0o644)
            with self.assertRaises(pages_http.ClientError) as caught:
                pages_http.read_token({"PAGES_API_TOKEN_FILE": str(filename)})
            self.assertNotIn("test-only-bearer", str(caught.exception))

    def test_invalid_token_configuration_fails_without_value(self):
        for environ in ({}, {"PAGES_API_TOKEN": "private\ninjected"}, {"PAGES_API_TOKEN": "private", "PAGES_API_TOKEN_FILE": "/unused"}):
            with self.assertRaises(pages_http.ClientError) as caught:
                pages_http.read_token(environ)
            self.assertNotIn("private", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
