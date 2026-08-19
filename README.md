# pages.live4.dev

Минималистичная публичная площадка для статей. Strapi 5 хранит черновики и медиа, Astro генерирует статические страницы, а отдельный publisher проверяет и атомарно переключает релизы.

## Архитектура

- `backend/` — Strapi 5.52.0, Draft & Publish, Blocks и закрытый publisher API;
- `src/` — Astro 6.4.8, главная и страницы `/<slug>/`;
- `publisher/` — сериализованная сборка, 15-минутные подписанные preview, release validation и rollback;
- `caddy/`, `scripts/`, `systemd/` — production routing, публикация и проверяемые backup;
- production state — PostgreSQL `pages_live4dev`, отдельные uploads и `/srv/pages-live4dev/current`.

Публичный Content API выключен на уровне прав Strapi и возвращает `404` на уровне Caddy. Админка доступна по `/admin` только после входа. MCP в этом проекте не включён.

## Локальная разработка

```sh
cp .env.example .env
docker compose up --build
```

- Strapi: `http://127.0.0.1:4351/admin`;
- publisher health: `http://127.0.0.1:4352/health`;
- статический релиз: `.releases/current`.

Frontend без Strapi:

```sh
npm install
npm run dev
npm run build:empty
npm run build:fixture
```

## Публикация

1. Создать статью в Strapi, заполнить title, slug, excerpt, publishedOn, language и Blocks body.
2. Для всех inline-изображений заполнить alternative text.
3. Сохранить draft. Он не попадает в публичный sitemap или текущий релиз.
4. Получить подписанный preview: `sudo -n /opt/pages-live4dev/scripts/preview.sh /<slug>/`.
5. Нажать Publish. Publisher собирает весь сайт и меняет `current` только после полной проверки.
6. Unpublish запускает новую сборку и удаляет маршрут из публичного релиза.

Slug должен состоять из `a-z`, цифр и дефисов. Зарезервированы `admin`, `api`, `uploads`, `__preview`, `_health` и `mcp`.

## Проверки

```sh
npm run test
npm run build:empty
npm run build:fixture
npm --prefix backend run typecheck
npm --prefix backend run build
docker compose config
```

Production-процесс, approval gates и rollback описаны в [docs/deployment.md](docs/deployment.md).
