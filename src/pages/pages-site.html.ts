import type { APIRoute } from 'astro';
import manifest from '../../public/pages-site-manifest.json';

// An explicit .html endpoint cannot collide with the CMS's hyphenated article slugs.
export const GET: APIRoute = () => new Response(`<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Установите скилл Pages для Codex: публикация статей и Markdown-файлов на pages.live4.dev.">
  <meta name="theme-color" content="#f7faf8">
  <title>Pages для Codex — Pages</title>
  <link rel="canonical" href="https://pages.live4.dev/pages-site.html">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="sitemap" href="/sitemap.xml">
  <link rel="stylesheet" href="/pages-site.css">
  <meta property="og:type" content="website">
  <meta property="og:title" content="Pages для Codex">
  <meta property="og:description" content="Публикуйте статьи и Markdown-файлы на Pages прямо из Codex. Установка одной командой.">
  <meta property="og:url" content="https://pages.live4.dev/pages-site.html">
  <script src="/metrika.js" defer></script>
  <script src="/pages-site-install.js" defer></script>
</head>
<body>
  <noscript><div class="metrika-noscript"><img src="https://mc.yandex.ru/watch/111762995" width="1" height="1" alt=""></div></noscript>
  <main id="content">
    <nav aria-label="Навигация">
      <a class="brand" href="/" aria-label="Pages — на главную">
        <svg viewBox="0 0 32 28" fill="none" aria-hidden="true"><path d="M2 10h6l5-5h6l5 5h6M2 17h6l5-5h6l5 5h6M2 24h6l5-5h6l5 5h6" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
        <strong>live4.dev</strong><span>/ Pages</span>
      </a>
      <a href="/pages-site.SKILL.md">SKILL.md</a>
    </nav>
    <header>
      <h1>Pages для Codex</h1>
      <p class="meta">Скилл pages-site · Версия ${manifest.version}</p>
      <p>Публикуйте статьи, заметки и Markdown-файлы на Pages прямо из Codex.</p>
    </header>
    <h2>Установка</h2>
    <p>Выполните команду в терминале:</p>
    <pre><code id="install-command">curl -fsS https://pages.live4.dev/pages-site-install.py | python3 -</code></pre>
    <div class="copy-row"><button type="button" data-copy-install hidden>Скопировать</button><span class="copy-status" data-copy-status role="status" aria-live="polite"></span></div>
    <p>Установщик проверит SHA-256 пакета и добавит скилл в <code>~/.codex/skills/pages-site</code>. Если задан <code>CODEX_HOME</code>, будет использован его каталог <code>skills</code>. Существующие файлы сохраняются.</p>
    <p>Скилл будет доступен на следующем ходе Codex. Для установки нужен Python 3.9 или новее. Для конвертации Markdown также нужны Node.js 20+ и npm; зависимости устанавливаются при первом использовании.</p>
    <h2>Как пользоваться</h2>
    <p>Попросите Codex:</p>
    <pre><code>Используй $pages-site и опубликуй файл /полный/путь/заметка.md</code></pre>
    <p>Скилл подготовит заголовок, адрес и форматирование, опубликует статью и проверит её публичную страницу. Чтобы оставить текст черновиком, укажите это в запросе.</p>
    <ul>
      <li>Публикация из .md и .markdown, в том числе с YAML-метаданными.</li>
      <li>Заголовки, выделение, ссылки, цитаты, списки и блоки кода.</li>
      <li>Чтение и редактирование существующих статей.</li>
    </ul>
    <h2>Доступ к Pages</h2>
    <p>Для работы со статьями нужен API-токен Pages с соответствующими правами. Сохраните его в защищённом файле вне Git, доступном только вашему пользователю, и передайте Codex путь к этому файлу. Не вставляйте токен в чат.</p>
    <p>Клиент использует <code>PAGES_API_TOKEN_FILE</code> или <code>PAGES_API_TOKEN</code>. Маршрут коллекции: <code>PAGES_API_COLLECTION_PATH=/api/articles</code>. Установка скилла не создаёт аккаунт и не предоставляет доступ к публикации.</p>
    <h2>Скачать пакет</h2>
    <div class="downloads"><a href="/${manifest.archive}" download>ZIP · ${Math.ceil(manifest.bytes / 1024)} КБ</a><a href="/pages-site.SKILL.md">Инструкции SKILL.md</a><a href="/pages-site-install.py" download>Установщик</a></div>
    <p>ZIP содержит инструкции, справочники, HTTP-клиент, конвертер Markdown и файлы зависимостей. Для ручной установки распакуйте каталог <code>pages-site</code> в <code>~/.codex/skills/</code>.</p>
    <details><summary>Контрольная сумма SHA-256</summary><pre><code>${manifest.sha256}</code></pre><p><a href="/${manifest.archive}.sha256">Скачать контрольную сумму</a></p></details>
    <footer><a href="/">← Все публикации Pages</a></footer>
  </main>
</body>
</html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
