#!/usr/bin/env python3
"""JSON HTTP client for Pages. Python 3.9+, standard library only."""

import argparse
from http.client import HTTPException
import json
import os
from pathlib import Path
import re
import socket
import ssl
import stat
import sys
from urllib import error, parse, request

ORIGIN = "https://pages.live4.dev"
METHODS = ("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE")
READ_METHODS = ("GET", "HEAD")
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
SECRET_KEYS = {
    "password", "token", "jwt", "authorization", "apitoken",
    "accesstoken", "refreshtoken", "secret",
}


class ClientError(Exception):
    pass


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def validate_path(path):
    parts = parse.urlsplit(path)
    if (not path.startswith("/") or path.startswith("//")
            or parts.scheme or parts.netloc or parts.query or parts.fragment
            or "?" in path or "#" in path):
        raise ClientError("Use a site-relative path; pass query parameters with --query.")
    decoded = path
    for _ in range(3):
        decoded = parse.unquote(decoded)
        if ("\\" in decoded or any(ord(c) < 32 or ord(c) == 127 for c in decoded)
                or any(part in (".", "..") for part in decoded.split("/"))):
            raise ClientError("Path contains a forbidden component.")
    return parse.quote(path, safe="/%:@-._~")


def read_token(environ=None):
    environ = os.environ if environ is None else environ
    token = environ.get("PAGES_API_TOKEN", "")
    filename = environ.get("PAGES_API_TOKEN_FILE", "")
    if token and filename:
        raise ClientError("Configure only one of PAGES_API_TOKEN or PAGES_API_TOKEN_FILE.")
    if filename:
        try:
            path = Path(filename).expanduser()
            metadata = path.stat()
            if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > 65536:
                raise ClientError("Token file must be a small regular file.")
            if metadata.st_mode & 0o077:
                raise ClientError("Token file must be accessible only to its owner (mode 0600).")
            token = path.read_text(encoding="utf-8").strip()
        except (OSError, UnicodeError):
            raise ClientError("Cannot read the configured token file.") from None
    if not token or any(c.isspace() or ord(c) < 32 or ord(c) == 127 for c in token):
        raise ClientError("Configure a valid Pages API token through the environment or a protected file.")
    if not token.isascii():
        raise ClientError("API token must contain ASCII characters.")
    return token


def redact(value, token=None):
    if isinstance(value, dict):
        return {
            redact(key, token): "[REDACTED]" if re.sub(r"[^a-z]", "", key.lower()) in SECRET_KEYS
            else redact(item, token)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact(item, token) for item in value]
    if isinstance(value, str) and token:
        return value.replace(token, "[REDACTED]")
    return value


def finalize(result, token):
    status = result["http_status"]
    if (result["method"] not in READ_METHODS and not result["ok"]
            and (status is None or 200 <= status < 400 or status >= 500)):
        result["mutation_outcome"] = "unknown"
    return redact(result, token)


def classify_failure(exc):
    reason = exc.reason if isinstance(exc, error.URLError) else exc
    if isinstance(reason, socket.gaierror):
        return "dns_error"
    if isinstance(reason, PermissionError):
        return "network_permission_denied"
    if isinstance(reason, (TimeoutError, socket.timeout)):
        return "request_timeout"
    if isinstance(reason, ssl.SSLError):
        return "tls_error"
    return "transport_or_response_error"


def perform(method, path, *, token=None, public=False, body=None, queries=(), timeout=20):
    method = method.upper()
    if method not in METHODS:
        raise ClientError("Unsupported HTTP method.")
    path = validate_path(path)
    if public and method not in READ_METHODS:
        raise ClientError("--public is available only for GET and HEAD.")
    if not public and not token:
        raise ClientError("Authenticated API requests require a Pages token.")
    if not 1 <= timeout <= 60:
        raise ClientError("Timeout must be between 1 and 60 seconds.")
    if body is not None and (method in READ_METHODS or not isinstance(body, dict)):
        raise ClientError("Request body must be a JSON object for a write operation.")
    if method in ("POST", "PUT", "PATCH") and body is None:
        raise ClientError("POST, PUT, and PATCH require --body with a JSON object.")
    url = ORIGIN + path
    if queries:
        url += "?" + parse.urlencode(queries)
    headers = {"Accept": "application/json", "User-Agent": "pages-site-http/1.0"}
    if not public:
        headers["Authorization"] = "Bearer " + token
    data = None
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    req = request.Request(url, data=data, headers=headers, method=method)
    result = {"method": method, "path": path, "http_status": None, "ok": False}
    try:
        try:
            response = request.build_opener(NoRedirect()).open(req, timeout=timeout)
        except error.HTTPError as exc:
            response = exc
        with response:
            result["http_status"] = response.code
            if 300 <= response.code < 400:
                result["error"] = "redirect_refused"
                return finalize(result, token)
            raw = response.read(MAX_RESPONSE_BYTES + 1)
            if len(raw) > MAX_RESPONSE_BYTES:
                result["error"] = "response_too_large"
                return finalize(result, token)
            if not raw:
                result["body"] = None
            else:
                text = raw.decode("utf-8")
                try:
                    result["body"] = json.loads(text)
                except json.JSONDecodeError:
                    if not public or not 200 <= response.code < 300:
                        result["error"] = "expected_json_response"
                        return finalize(result, token)
                    result["body"] = text
            result["ok"] = 200 <= response.code < 300
            if not result["ok"]:
                result["error"] = "http_error"
    except (OSError, error.URLError, HTTPException, UnicodeError, ValueError) as exc:
        result["error"] = classify_failure(exc)
    return finalize(result, token)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("method", choices=METHODS)
    parser.add_argument("path", help="Verified route on https://pages.live4.dev; no query string")
    parser.add_argument("--query", action="append", default=[], metavar="KEY=VALUE")
    parser.add_argument("--body", type=Path, help="JSON request file; schema is determined by the actual API")
    parser.add_argument("--public", action="store_true", help="GET/HEAD without reading or sending a token")
    parser.add_argument("--timeout", type=int, default=20)
    args = parser.parse_args(argv)
    try:
        validate_path(args.path)
        if args.public and args.method not in READ_METHODS:
            raise ClientError("--public is available only for GET and HEAD.")
        queries = []
        for item in args.query:
            key, separator, value = item.partition("=")
            if not separator or not key:
                raise ClientError("Each --query must have the form KEY=VALUE.")
            queries.append((key, value))
        body = None
        if args.body:
            try:
                body = json.loads(args.body.read_text(encoding="utf-8"))
            except (OSError, UnicodeError, json.JSONDecodeError):
                raise ClientError("Cannot read --body as a JSON request file.") from None
        token = None if args.public else read_token()
        result = perform(args.method, args.path, token=token, public=args.public,
                         body=body, queries=queries, timeout=args.timeout)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result["ok"] else 1
    except ClientError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
