# @booster-plugins/booster-checkout

Главный UI-плагин `steambooster`: кнопка «Пополнить» в шапке Steam,
popup с пополнением кошелька, оплатой, поддержкой и просмотром
заказов. Работает в `Main`-контексте Steam — там, где живёт нативная
шапка и системные popup'ы.

## Назначение

- Кнопка `Пополнить` в шапке Steam рядом с нативными `Магазин`,
  `Сообщество`, `<persona>` и т.д. Визуально неотличима от системного
  стиля Steam'a.
- Popup'a: Svelte 5 root + scoped CSS + tokens, инлайнится в бандл как
  HTML-строка (`__SB_POPUP_HTML__`). Подцепляется через
  `sb.ui.attachPopup` к header-button'у и поддерживает реактивный
  state через broadcast-channel'ы.
- Конфиги пользователя (выбранная валюта, последний amount, прочее)
  через `sb.configs.read/write` (шифрование на стороне инжектора —
  libsodium XChaCha20-Poly1305).
- Bus-сообщения popup ↔ main shell для команд (open, refresh, close).

## Поверхность фреймворка

| Поле в `PluginManifest` | Значение |
|-------------------------|----------|
| `id` | `booster-checkout` |
| `apiVersion` | `1` |
| `contextKinds` | `[ContextKind.Main]` |
| `capabilities` | `Ui, Steam, Configs, Bus` |
| `displayName` | `SteamBalance — Пополнить` |

Source-of-truth — [`src/index.ts`](./src/index.ts).

## Внутреннее устройство

```
booster-checkout/
├── src/
│   ├── index.ts              # PluginManifest, register({...}), init
│   ├── main/                 # Main-context модули
│   │   ├── install.ts        # Header button + popup attach
│   │   ├── headers.ts        # Header-button setup
│   │   ├── payment-methods.ts
│   │   └── urls-helper.ts    # сборка orders/support URL из URLS-констант
│   ├── lib/                  # Pure helpers (currency и т.п.)
│   ├── i18n.ts               # typesafe-i18n init
│   ├── urls.ts
│   └── generated/messages.ts # gen-strings output
├── popup-svelte/             # Svelte 5 root (UI popup'a)
│   ├── App.svelte
│   ├── main.ts
│   ├── components/
│   ├── lib/                  # popup-side state (.svelte.ts)
│   ├── styles/
│   └── __tests__/
├── scripts/build-popup.ts    # Svelte tree → inline HTML строку
├── strings/                  # ru.json fragment (мердж с корневым)
├── tests/                    # bun test suites
├── assets/                   # SVG-иконки и т.п.
├── build.ts                  # bun build → out/booster-checkout-VERSION.js
├── package.json
└── README.md                 # (этот файл)
```

Build-pipeline:

1. `scripts/build-popup.ts` — `bun-plugin-svelte` собирает Svelte
   tree в single-file HTML (CSS+JS инлайнены).
2. `build.ts` — `bun build src/index.ts --format iife --target browser`
   с define'ом `__SB_POPUP_HTML__ = "<html...>"`.
3. Output: `out/booster-checkout-<version>.js` (+ `.js.map` для
   dev).

## Команды

```pwsh
cd packages/booster-checkout

bun install
bun run build                  # dev build (external .js.map)
SB_PRODUCTION=1 bun run build  # production (minified, без sourcemap)
bun test                       # все тесты пакета
bun test tests/headers.test.ts # точечно
```

## Зависимости

- `@steambalance/booster-framework` (workspace).
- `svelte@^5.55` + `bun-plugin-svelte` — popup UI.
- `typesafe-i18n` — generated RU-strings.
- `happy-dom` — test runtime.
- `postcss` + `autoprefixer` + `cssnano` + `postcss-preset-env` —
  CSS pipeline для Svelte.

## Документация по используемым API

- [Plugin contract](../../../booster-framework/docs/plugin-contract.md)
- [Capabilities](../../../booster-framework/docs/capabilities.md)
- [UI API](../../../booster-framework/docs/ui-api.md) — header button + attachPopup.
- [Configs API](../../../booster-framework/docs/configs-api.md)
- [Bus API](../../../booster-framework/docs/bus-api.md) — popup ↔ shell.
- [Scope API](../../../booster-framework/docs/scope-api.md) — cleanup паттерны.

## Релизы

См. [`../../docs/release-process.md`](../../docs/release-process.md).
Tag — `booster-checkout-v<X.Y.Z>`.

## License

MIT.
