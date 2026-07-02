# OGame RU Dashboard

Локальный и статический dashboard по публичной статистике RU-вселенных OGame.

## Локальный запуск

```powershell
npm.cmd run fetch
npm.cmd start
```

После запуска откройте `http://localhost:5173`.

Настройки локального запуска лежат в `.env`:

```env
PORT=5173
BASE_PATH=
UNIVERSE_LIMIT=0
```

`UNIVERSE_LIMIT=0` означает сбор всех вселенных. Для быстрой проверки можно поставить `1`.

## GitHub Pages

Проект готов к публикации через GitHub Pages без backend-сервера.

Workflow `.github/workflows/deploy-pages.yml`:

- запускается при push в `main`;
- запускается вручную через `workflow_dispatch`;
- запускается раз в сутки по расписанию `30 11 * * *` UTC;
- выполняет `npm run fetch`;
- собирает статическую папку `dist`;
- публикует `public/*` и свежий `data/ogame-ru.json` на GitHub Pages.

В репозитории нужно открыть:

```text
Settings -> Pages -> Build and deployment -> Source -> GitHub Actions
```

На GitHub Pages кнопка ручного обновления скрывается, потому что обновление делает GitHub Action.

## Данные

Локально данные сохраняются в:

```text
data/ogame-ru.json
```

Этот файл игнорируется git. На GitHub Pages он создается заново во время workflow.

Текущая версия хранит только последний снимок данных. История изменений очков пока не сохраняется.
