# Pages HTTP connection

## Known connection state

| Setting | Value or requirement |
| --- | --- |
| HTTPS origin | `https://pages.live4.dev` |
| API collection route | `/api/articles`; set `PAGES_API_COLLECTION_PATH=/api/articles` |
| Authentication | Bearer token through `PAGES_API_TOKEN` or `PAGES_API_TOKEN_FILE` |
| Token file | Outside Git, regular file, owner-only access (mode `0600`) |
| HTTP client | [scripts/pages_http.py](../scripts/pages_http.py), Python 3.9+, standard library |
| Document route | `/api/articles/<documentId>` |
| Public article URL | `https://pages.live4.dev/<slug>/` |
| Publication | Explicit `status=published`; existing Strapi lifecycle requests a static publisher build |

Verified on 2026-09-27 against the local Pages source and production HTTPS routing: the home page returns `200`, `/api/articles` and document routes require a Bearer header (`401` when absent), and an invalid token reaches Strapi and is rejected. Authenticated collection reads, creation with `status=published`, document readback and generated public pages were verified successfully using the user's API token. The edge exposes only article routes; other `/api/*`, including `/api/publisher/site`, remain `404`. Anonymous Strapi permissions were not enabled.

Pages uses the standard Strapi 5 article REST API. The project is a static Astro site with an existing publisher; a CMS publication and a generated public page remain separate verification steps. No external publisher trigger is exposed.

## Article fields

| Field | Contract |
| --- | --- |
| `title` | Required string, 1–180 characters |
| `slug` | Required unique UID, lowercase letters/numbers separated by single hyphens |
| `excerpt` | Required text, 1–320 characters |
| `publishedOn` | Required date, `YYYY-MM-DD` |
| `language` | Required enum `ru` or `en`; this is an article field, not a Strapi i18n locale |
| `body` | Required Strapi Blocks array |
| `author` | Optional string, up to 180 characters |
| `cover` | Optional single image media relation |

Draft & Publish is enabled. This collection does not enable the i18n plugin, so do not invent a locale query. Reserved slugs are `admin`, `api`, `uploads`, `__preview`, `_health`, `mcp`, `new`, and `fonts`. The Content API needs a Strapi API token with the requested article permissions. The server's `STRAPI_API_TOKEN` is a separate internal publisher secret, not a Content API token.

Configure credentials through the execution environment or a protected file. The client reads the token internally; it has no `--token` option. Do not save a token in this skill, example payloads, shell history, diagnostic output, or a Git repository. Token values provided in chat must not be repeated or embedded in tool commands.

The bundled client keeps TLS verification enabled, sends credentials only to this exact HTTPS origin, refuses redirects, suppresses raw non-JSON API errors, redacts recognized credential fields and any echoed configured token, and never retries a request. It honors the runtime's proxy environment and permission boundaries. It does not provide admin login, token provisioning, backups, or infrastructure operations.

## HTTP examples

Resolve the client path from the loaded skill. For a standard global installation:

```sh
pages_skill_dir="${CODEX_HOME:-$HOME/.codex}/skills/pages-site"
pages_http_client="$pages_skill_dir/scripts/pages_http.py"
python3 "$pages_http_client" GET / --public
python3 "$pages_http_client" GET "$PAGES_API_COLLECTION_PATH" --query 'pagination[pageSize]=3'
python3 "$pages_http_client" GET "$PAGES_API_COLLECTION_PATH" --query 'status=draft' --query 'filters[slug][$eq]=test-batch-short-note'
python3 "$pages_http_client" POST "$PAGES_API_COLLECTION_PATH" --query 'status=draft' --body /absolute/private/path/page.json
python3 "$pages_http_client" GET "$PAGES_API_COLLECTION_PATH/$PAGES_DOCUMENT_ID" --query 'status=draft'
python3 "$pages_http_client" PUT "$PAGES_API_COLLECTION_PATH/$PAGES_DOCUMENT_ID" --query 'status=published' --body /absolute/private/path/page.json
```

The environment must already contain the verified collection path and, for document operations, the returned `PAGES_DOCUMENT_ID`. Private payload paths above are illustrative; create and validate the actual JSON file before a write. Use only fields and publication operations supported by the site's contract.

The client returns an envelope with `ok`, `http_status`, and `body`. The API's `data` is inside `body`; it is not the client's outer response object. Exit codes: `0` successful HTTP response, `1` HTTP/transport/response failure, `2` invalid local configuration or input. A successful HTTP response still needs record readback and public-page verification.

For snapshots, set `umask 077` and save sanitized GET results in a protected directory outside Git. Record both relevant publication versions, document IDs, locale, and relations/components needed for the change. Do not overwrite a snapshot from another operation. Transport errors on writes can include `mutation_outcome: unknown`; investigate the batch through GET before retrying.

## Standard Strapi 5 REST contract

Apply this contract only after confirming Pages uses the standard API rather than a custom endpoint:

- Collections use `GET`/`POST` at their configured collection route. Document reads, partial field updates, and deletion use `GET`/`PUT`/`DELETE` at that route plus the returned `documentId`.
- Write bodies contain a `data` object. Strapi 5 document fields are directly inside response `data`, without a v4 `attributes` wrapper. Relations, components, and media require the appropriate `populate` query to read back.
- With Draft & Publish enabled, explicitly supply `status=draft` or `status=published` when creating or updating. Current documentation says omission can publish immediately; verify behavior for the deployed Pages version.
- Use `locale` where the content type supports it. Do not invent a REST `/publish` or `/unpublish` route. If unpublishing is requested, obtain its supported HTTP operation before writing.

Sources checked on 2026-09-27: [REST API](https://docs.strapi.io/cms/api/rest), [publication status](https://docs.strapi.io/cms/api/rest/status), [API tokens](https://docs.strapi.io/cms/features/api-tokens).

## Diagnose HTTP access

- DNS, TLS, timeout, or sandbox denial: transport failure; the server has not necessarily seen the token.
- `301`/`302`/other redirect: the client stops. Check the documented canonical route without forwarding the token automatically.
- `401`: authentication was rejected; check the configured token and its documented expiry.
- `403`: check the documented token permissions and edge access policy.
- `404`: verify the route and document ID. A collection name from SQL is insufficient.
- JSON validation error: compare the payload with the actual schema; do not change the schema or permissions as a workaround.

For separately requested server development, backups, releases, recovery, or route exposure, use the site owner's operational workflow. Those operations are not prerequisites of this HTTP content workflow.
