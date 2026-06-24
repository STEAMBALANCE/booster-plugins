# @booster-plugins/booster-addfunds

Page-mod для Steam-страницы пополнения кошелька
(`store.steampowered.com/steamaccount/addfunds`). Запускается в
Web-контексте встроенного браузера, добавляет к нативной странице
строку «Пополнить кошелёк» с pre-fill валюты, которая роутит
пользователя в popup `booster-checkout` для собственно платежа.

## Назначение

- Распознаёт `/steamaccount/addfunds` через `sb.pages.register` +
  URL-pattern, mountит UI только когда страница активна, размонтирует
  на навигации.
- Pre-fill amount + валюту из последнего user-выбора (читается через
  `sb.configs.read` под namespace'ом плагина).
- Bus-сообщение к Main shell'у на user-action → popup `booster-checkout`
  открывается с заранее заполненной суммой.
- Без собственного UI-фреймворка (HTML + plain DOM helpers). Размер
  бандла критичен для Web-контекста — он загружается на каждой
  навигации в Web-target'е.

## Поверхность фреймворка

| Поле в `PluginManifest` | Значение |
|-------------------------|----------|
| `id` | `booster-addfunds` |
| `apiVersion` | `1` |
| `contextKinds` | `[ContextKind.Web]` |
| `urlPatterns` | `^https://store\.steampowered\.com/steamaccount/addfunds(/.*)?$` |
| `capabilities` | `Ui, Steam, Configs, Bus, Pages` |
| `displayName` | `SteamBalance — AddFunds` |

Source-of-truth — [`src/index.ts`](./src/index.ts): `contextKinds`
ограничены `[Web]`, набор `capabilities` не включает `Auth`.

**Зачем `Web` без `Main`.** Плагин — page-mod, живёт только когда
пользователь открыл `/steamaccount/addfunds`. В Main-контексте он
ничего не делает; вся cross-context коммуникация идёт через `sb.bus`
(broadcast-channel под капотом).

**Зачем нет `Auth`.** Auth (Steam JWT) запрашивает только Main-сторона
через `booster-checkout`. Web-плагин просто публикует bus-сообщение «открыть
popup с такой-то суммой», Main подбирает его и сам разруливает auth.
Плагин запрашивает только тот набор capability, который реально
использует (см.
[`capabilities.md`](../../../booster-framework/docs/capabilities.md)).

**`Pages`-capability** — для самой функции `sb.pages.register({name,
match, mount})` (`mount` возвращает cleanup-fn), основы Web-плагина.

## Внутреннее устройство

```
booster-addfunds/
├── src/
│   ├── index.ts              # sb.plugins.register({...}) с полем init
│   ├── plugin-meta.ts        # PluginMeta (id, contextKinds, capabilities…)
│   ├── install.ts            # installAddFundsWeb(ctx) → cleanup
│   ├── pages/
│   │   ├── addfunds.ts       # registerAddFundsPage(sb)
│   │   └── addfunds.css      # scoped-стиль строки (#booster-addfunds-row)
│   ├── lib/
│   │   └── currency.ts       # currency helpers
│   ├── css.d.ts              # типизация `import … with { type: 'text' }`
│   ├── i18n.ts
│   └── generated/messages.ts
├── strings/                  # ru.json fragment
├── tests/                    # bun test suites
│   ├── addfunds.test.ts
│   ├── i18n.test.ts
│   └── prod-build-flags.test.ts
├── assets/images/logo.png    # инлайнится в бандл как data URI
├── build.ts                  # bun build → out/booster-addfunds-<ver>.js
├── package.json
└── README.md                 # (этот файл)
```

Build:

- `build.ts` собирает IIFE-бандл и, в отличие от шаблона, инлайнит в него
  два build-time-define'а: PNG-логотип как `data:`-URI
  (`__SB_ADDFUNDS_LOGO_DATA_URI__`) и scoped-стиль строки
  (`__SB_ADDFUNDS_CSS__`), который в production прогоняется через
  CSS-минификатор Bun (`tools/load-css.ts`). Версия читается из
  `package.json::version`.
- Без Svelte и без отдельного UI-фреймворка — page-mod встраивается в
  существующий Steam DOM, переиспользует Steam-классы, а собственный
  стиль строки скоупится под `#booster-addfunds-row`, чтобы не протекать на
  вёрстку Steam.

## Команды

```pwsh
cd packages/booster-addfunds

bun install
bun run build                  # dev build (inline sourcemap)
SB_PRODUCTION=1 bun run build  # production (minified, external sourcemap)
bun test                       # все тесты
bun test tests/addfunds.test.ts
```

## Зависимости

- `@steambalance/booster-framework` (workspace).
- `typesafe-i18n` — generated RU-strings.
- `happy-dom` — test runtime.

Без UI-фреймворка и без тяжёлого CSS-пайплайна — единственный стиль
строки минифицируется и инлайнится прямо в бандл. Это by-design:
Web-контекст требует минимального cold-start'a.

## Документация по используемым API

- [Plugin contract](../../../booster-framework/docs/plugin-contract.md)
- [Capabilities](../../../booster-framework/docs/capabilities.md)
- [UI API](../../../booster-framework/docs/ui-api.md) — DOM-mount внутри
  Web-страницы.
- [Steam API](../../../booster-framework/docs/steam-api.md) —
  `getCurrentUser`, `openUrl` для перенаправлений.
- [Configs API](../../../booster-framework/docs/configs-api.md) — pre-fill
  amount.
- [Bus API](../../../booster-framework/docs/bus-api.md) — Web→Main popup
  команда.
- [Pages API](../../../booster-framework/docs/pages-api.md) — URL-matched
  mount/unmount, основа этого плагина.
- [Scope API](../../../booster-framework/docs/scope-api.md) — cleanup при
  навигации с страницы.

## Релизы

См. [`../../docs/release-process.md`](../../docs/release-process.md).
Tag — `booster-addfunds-v<X.Y.Z>`.

## License

MIT.
