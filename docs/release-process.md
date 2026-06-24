# booster-plugins release process

Описывает, как пакеты `@booster-plugins/booster-checkout` и
`@booster-plugins/booster-addfunds` попадают из git-tag'а в production-манифест,
который раздаёт нативный инжектор `steambooster.exe`. GitHub Actions release
workflow ещё не подключён — сегодня сборка бандла и attach к релизу
делаются вручную; подписание и публикация манифеста выполняются
релиз-pipeline'ом оператора.

## TL;DR

1. Maintainer тегает `booster-<plugin>-v<X.Y.Z>` на `main`.
2. CI (`.github/workflows/release.yml`, ещё не подключён) соберёт
   IIFE-бандл и приложит его к GitHub Release. Пока workflow нет, бандл
   собирается локально и прикладывается вручную через `gh release create`.
3. Оператор запускает релиз-pipeline, который:
   - подтягивает свежие плагин-бандлы через `gh release download`,
   - считает SHA-256, заполняет записи манифеста,
   - подписывает манифест Ed25519-ключом,
   - публикует на CDN.
4. Инжекторы у пользователей получают новый манифест на следующем
   poll-тике, скачивают и hot-загружают новые версии плагинов.

## Versioning

Семантическое (semver), пакетный scope:

- `booster-<plugin>-v0.X.Y` — пока `apiVersion: 1` стабилен и нет
  публичного v1.0.0 у framework'a, плагины двигаются по 0.x.y.
- **Bump-rules:**
  - patch (`0.1.0 → 0.1.1`) — bug fix, нет API-impact, нет config
    schema migration.
  - minor (`0.1.0 → 0.2.0`) — новая feature, требует свежий manifest,
    но не ломает существующих пользователей.
  - major (`0.x.y → 1.0.0`) — стабилизация. Не делаем без явного
    разрешения maintainer'a и согласования с framework v1.0.0.
- **Breaking change в записи плагина** (новый capability, изменение
  `contextKinds`, новый `urlPatterns` для Web-плагина) — требует minor
  bump и сопровождается анонсом, потому что у пользователей
  capability-grant идёт через accept-prompt.

## Tag convention

Один тег = один плагин = один релиз. Tag-name:

```
booster-checkout-v0.1.0
booster-addfunds-v0.1.0
```

**НЕ используем** mono-тегов вида `v0.1.0` — они привязывают два пакета
к одной версии, что блокирует независимый release-cadence.

Tag'и идут на коммит `main`, в котором `packages/<plugin>/package.json::version`
уже обновлён. Pre-flight check:

```pwsh
git checkout main
git pull
cd packages/booster-checkout
cat package.json | jq .version    # должен совпадать с tag'ом
cd ../..
git tag booster-checkout-v0.1.0
git push origin booster-checkout-v0.1.0
```

## GitHub Actions release workflow

Файл — `.github/workflows/release.yml` (ещё не подключён). Trigger —
push на tag'и `booster-*-v*`. Запланированные шаги:

1. Checkout с tag'om.
2. `bun install`.
3. Determine `PLUGIN_ID` из tag-name (`booster-checkout-v0.1.0` → `booster-checkout`).
4. `cd packages/$PLUGIN_ID && SB_PRODUCTION=1 bun run build`.
5. Артефакты:
   - `out/<id>-<version>.js` — minified IIFE.
   - `out/<id>-<version>.js.map` — external sourcemap
     (хранится приватно, не публикуется на CDN, нужен только для
     crash-symbolication).
6. `gh release create $TAG out/<id>-<version>.js --notes-file CHANGELOG.md`
7. (опционально) trigger downstream release-workflow оператора через
   `repository_dispatch`.

Пока workflow не подключён — собирайте бандл локально и прикладывайте
через `gh release create` вручную.

## Build artefacts

```
out/
└── booster-checkout-0.1.0.js          # 30-150 KB, public
└── booster-checkout-0.1.0.js.map      # private, debug only
```

Naming pattern фиксирован: `<id>-<version>.js`. Injector
ожидает именно его (`build.ts::naming` в плагине + `release.ts`
парсит).

**Public-facing**: только `.js`. **Не аплоадим**:

- `.js.map` — содержит исходники, не для публики (хранится у
  maintainer'a + в GitHub Actions secret'ах для crash-symbolication).
- `node_modules/`, `dist/` framework'a — не нужны на CDN.

## Обновление манифеста

Сам по себе теговый release плагина — это половина истории. Нативный
инжектор читает не GitHub releases, а **подписанный манифест** на CDN.
Манифест обновляется релиз-pipeline'ом оператора. Пайплайн
интерактивный:

1. Спрашивает примерно пять параметров: build-mode (дефолт — Production),
   URL манифеста, версию инжектора, версию фреймворка,
   `minInjectorVersion`. Версии плагинов pipeline НЕ спрашивает — они
   читаются из `packages/<plugin>/package.json` каждого пакета.
2. Подтягивает бандлы плагинов через `gh release download -R
   STEAMBALANCE/booster-plugins --pattern '<id>-<version>.js'` и
   считает SHA-256.
3. Заполняет запись манифеста: `{id, version, apiVersion, contextKinds,
   urlPatterns, grantedCapabilities, url, sha256}`. Внутренние плагины
   попадают в `requiredPlugins[]`, проверенные сторонние — в
   `approvedPlugins[]`.
4. Подписывает манифест Ed25519-ключом, выставляет свежий `issuedAt`.
5. Аплоадит манифест + плагин-бандлы на CDN (бандл внутреннего плагина
   стейджится как `plugins/<id>-<ver>.js`).
6. Инжекторы поллят манифест примерно раз в час (с джиттером); на новом
   тике скачивают бандл, проверяют SHA-256 + `apiVersion` + capability'и
   и hot-reload'ят.

Релиз-pipeline — semi-automated: maintainer всё равно делает review
плагина перед добавлением в манифест. Сам по себе теговый release ничего
на production не выкатывает.

## Approval (новые плагины и major bump'ы)

Сейчас approval — manual:

1. Maintainer прогоняет плагин через QA-чек-лист (см.
   [`testing.md`](https://github.com/STEAMBALANCE/booster-framework/blob/main/docs/testing.md)
   во фреймворке).
2. Live-тест в `steambooster-dev.exe` с реальным Steam.
3. Если плагин запрашивает чувствительные capability'и (например,
   `auth`) — дополнительно security-review. Сторонним (не `booster-`)
   плагинам инжектор `auth` не выдаёт вовсе — это ограничение
   загрузчика манифеста.
4. После approval'а maintainer добавляет плагин в секцию
   `approvedPlugins` манифеста через релиз-pipeline.

Пакеты этого репозитория (`booster-checkout`, `booster-addfunds`) — внутренние,
они едут в `requiredPlugins[]` и инжектор подгружает их всегда. Approval
для них делается одноразово; каждый последующий tag — patch / minor —
апрувится maintainer'ом без отдельной портал-формы.

## Rollback

Если новая версия плагина оказалась сломанной:

- **Быстрый kill-switch.** В манифесте есть top-level `disabled: true`
  + `disabledMessage` (cap 4 КБ). Инжектор прочитает его на следующем
  poll-тике и выключит все плагины.
- **Per-plugin rollback.** В манифесте поменять `version + url + sha256`
  у конкретного плагина обратно на предыдущий рабочий. Инжектор
  скачает старый бандл и hot-reload'нёт.
- **Никогда не depublish'им GitHub release.** Бандл доступен по
  versioned URL, пока на него ссылается любой манифест (текущий или
  закешированный на инжекторах). Удалять release нельзя — поломаются
  клиенты, которые ещё не сделали poll-тик.

## Будущая работа

Полная автоматизация — `release.yml` + downstream-trigger у оператора +
автоматический manifest-PR с подписью через облачный KMS — пока в
backlog оператора. Сегодня maintainer тегает вручную, релиз-pipeline
запускается вручную, ключ подписи живёт у maintainer'а
локально.

## Cheatsheet

```pwsh
# Tag a new patch release for booster-checkout:
cd booster-plugins
# 1. Bump packages/booster-checkout/package.json::version → 0.1.1
# 2. Commit:
git add packages/booster-checkout/package.json
git commit -m "chore(booster-checkout): bump to 0.1.1"
git push origin main
# 3. Tag + push:
git tag booster-checkout-v0.1.1
git push origin booster-checkout-v0.1.1
# 4. Собираем бандл и прикладываем к GitHub Release (вручную, пока нет CI)
# 5. Оператор запускает релиз-pipeline → манифест обновляется + публикуется на CDN
```
