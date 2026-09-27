# Publish Markdown files on Pages

Use this workflow for user-selected local .md or .markdown files. It creates or updates articles through the existing authenticated HTTPS API; it does not deploy the site. Read [the HTTP connection reference](site.md) alongside this document.

## Prepare the article

Read the selected file from its supplied location. Do not publish neighboring files, recursively import a folder, follow local attachments, or rewrite the source unless the user requested it. For a requested batch, prepare every selected file before the first write and check that their slugs are distinct.

The bundled converter needs Node.js 20+ and its pinned parser dependencies. Resolve its directory from the loaded SKILL.md. This example uses the global installation:

~~~sh
pages_skill_dir="${CODEX_HOME:-$HOME/.codex}/skills/pages-site"
npm --prefix "$pages_skill_dir/scripts" ci --ignore-scripts --no-audit --no-fund
umask 077
pages_workdir=$(mktemp -d /tmp/pages-markdown.XXXXXX)
node "$pages_skill_dir/scripts/pages_markdown.mjs" /absolute/path/article.md \
  --output "$pages_workdir/article.json"
~~~

The command writes a mode-0600 JSON request containing only a data object, prints a short preparation summary and never sends an HTTP request. It refuses to overwrite an existing output file. Keep the prepared payload and write/readback results outside Git until publication is confirmed. Do not install the converter's dependencies into the website project.

Optional YAML frontmatter:

~~~markdown
---
title: Заметка из Markdown
slug: markdown-demo
excerpt: Короткое описание публикации.
author: Автор
publishedOn: 2026-09-27
language: ru
---
# Заметка из Markdown

Первый абзац с **выделением** и [ссылкой](https://pages.live4.dev/).

## Раздел

- Первый пункт
- Второй пункт
~~~

Metadata precedence is CLI option, frontmatter, then defaults:

| Pages field | Frontmatter | Default / CLI |
| --- | --- | --- |
| title | title | Leading H1, otherwise filename without extension; --title |
| slug | slug | Title transliterated to lowercase Latin; --slug |
| excerpt | excerpt or description | First prose paragraph, at most 320 characters; otherwise title; --excerpt |
| author | author | Omitted; --author |
| publishedOn | publishedOn or date | Current date in Europe/Moscow; --date YYYY-MM-DD |
| language | language | ru; --language ru or en |
| body | Markdown after frontmatter | Native Strapi Blocks |

The leading H1 becomes the article title and is removed from body; explicit metadata overrides its text. Body headings must be H2–H4. Inspect the generated title, slug, date, excerpt and body before writing. Other frontmatter keys, including IDs, status, draft, cover and timestamps, are not sent. The user's requested publication state is supplied explicitly to the HTTP API. No token belongs in frontmatter.

For a new article, the converter prepares all required fields. For an update, first resolve and snapshot the existing draft/published document through the API. Send only the converted fields the user asked to change, commonly title and body; preserve existing slug, date, author, language, excerpt and cover unless their change was requested. Defaults generated for a new article must not overwrite existing metadata incidentally.

## Formatting and attachments

Supported: paragraphs, H2–H4, bold, italics, strikethrough, inline code, hard line breaks, ordinary and reference-style links, paragraph quotes, fenced/indented code, ordered/unordered lists and nested lists. Multiple paragraphs in a quote or list item keep blank-line separation. Nested lists use Strapi's native representation: the nested list follows its parent list-item as a sibling in the list's children.

The converter stops with a source line number for raw HTML, tables, footnotes, task lists, thematic separators, extra H1/H5/H6 headings, unresolved Obsidian wiki links/embeds, code-fence metadata and structures the Pages model cannot represent. Ordered lists must start at 1. List items support paragraphs followed by nested lists; paragraphs after a nested list need adaptation. Link tooltip titles have no Pages field; visible labels and destinations are retained. Explain an unsupported construct and prepare a faithful supported alternative when the user's request allows editing; do not silently remove content.

HTTP(S), mailto, site-relative URLs beginning with a single slash, and fragments are accepted. Relative file links must be resolved to real public URLs through an optional JSON --link-map:

~~~json
{
  "other-note.md": "https://pages.live4.dev/other-note/"
}
~~~

Resolve each destination from an existing publication or the explicitly requested batch. Do not invent a public route or publish a linked file implicitly. Fragments require an anchor that actually exists on the target page; Pages does not currently generate IDs for headings, so Markdown-generated table-of-contents links need adaptation.

An image must occupy its own paragraph and refer to existing Pages media through --media-map. Keys are the image destinations from Markdown, including reference-image definitions. Values are complete existing Strapi image objects obtained from an authorized source, with at least name, url, width, height and alternativeText:

~~~json
{
  "./diagram.png": {
    "name": "diagram.png",
    "url": "/uploads/diagram.png",
    "width": 800,
    "height": 450,
    "alternativeText": "Описание схемы"
  }
}
~~~

The example shows the minimum fields the converter checks; retain the actual media object's remaining fields. Markdown alt text takes precedence over existing alternativeText; an image title becomes its caption. Images must resolve to https://pages.live4.dev/uploads/. The converter does not read, upload or download image files.

The exposed Content API currently permits article routes only; /api/upload is blocked by Caddy. Do not attempt admin authentication, SSH, broader API permissions or a new route to upload an attachment. If required images have not been uploaded, finish preparing the text and identify the missing media. Have the owner provide existing Pages media or upload it through the Pages editor, unless a separately authorized HTTPS upload mechanism becomes available. Keep the article unpublished until required images are resolved, or omit them only when the user explicitly requests that.

## Publish and verify

Use the existing HTTP client and protected Pages token described in the skill. The converter needs no token. First make a public read and an authenticated collection read, then search the candidate slug in both draft and published status. The following example matches the frontmatter above:

~~~sh
python3 "$pages_skill_dir/scripts/pages_http.py" GET "$PAGES_API_COLLECTION_PATH" \
  --query 'status=draft' --query 'filters[slug][$eq]=markdown-demo'
python3 "$pages_skill_dir/scripts/pages_http.py" GET "$PAGES_API_COLLECTION_PATH" \
  --query 'status=published' --query 'filters[slug][$eq]=markdown-demo'
~~~

Resolve matches from the user's intended target; do not overwrite an unrelated document. If this file's content is already published unchanged, return the existing verified URL instead of creating a duplicate. Before updating an existing document, retain private snapshots of both relevant versions.

For a new publication:

~~~sh
python3 "$pages_skill_dir/scripts/pages_http.py" POST "$PAGES_API_COLLECTION_PATH" \
  --query 'status=published' --body "$pages_workdir/article.json" \
  > "$pages_workdir/create-result.json"
~~~

Use status=draft for an explicitly requested draft. For an authorized update, use PUT with the resolved documentId and only the fields selected for change. Do not invent a /publish endpoint. Save documentId, slug, source path and requested state after each successful write.

Read the requested CMS version back and compare title/body/metadata with the prepared payload. If a write fails or times out with unknown outcome, query its slug/documentId before considering a retry. Never retry writes automatically or publish again merely to speed up the publisher.

For published articles, let the existing publisher build the static site. Check the real /<slug>/ page through public HTTPS: title, representative body text, formatting, link targets and images. Allow up to two minutes with bounded read-only checks for the static release; if it has not appeared, report the confirmed CMS publication and pending/failed public build separately. For drafts, verify the draft API version and report its documentId; do not claim a public page exists.

Report one result per selected file, with confirmed public links or draft IDs, and any unsupported content or unresolved publication. Leave source Markdown untouched.
