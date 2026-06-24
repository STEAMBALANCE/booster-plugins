# booster-plugins

Обязательные open-source плагины проекта `steambooster` (монорепозиторий
на Bun workspaces). Нативный инжектор подгружает их всегда — они приходят
в production-манифесте как `requiredPlugins`. Каждый пакет собирается в
отдельный IIFE-бандл, попадает в подписанный манифест через
релиз-pipeline оператора и подписывается общим Ed25519-ключом проекта.

`steambooster` — это generic-хост: инжектор (`steambooster.exe`) запускает
Steam с включённым Chrome DevTools Protocol и внедряет в него
TypeScript-фреймворк `@steambalance/booster-framework` вместе с набором плагинов
из манифеста. Плагины этого репозитория реализуют пользовательские фичи
поверх стабильного API `window.sb`; кнопка «Пополнить» в шапке Steam —
лишь одна из фич плагина `booster-checkout`, а не назначение продукта.

## Плагины

| Пакет | Назначение | ContextKind | Capabilities |
|-------|------------|-------------|--------------|
| [`packages/booster-checkout/`](./packages/booster-checkout/README.md) | Popup пополнения, оплата, поддержка, заказы — основной UI в шапке Steam. | `Main` | `Ui, Steam, Configs, Bus, Pages, Auth` |
| [`packages/booster-addfunds/`](./packages/booster-addfunds/README.md) | Page-mod для `store.steampowered.com/steamaccount/addfunds` — pre-fill суммы и роутинг в popup `booster-checkout`. | `Web` | `Ui, Steam, Configs, Bus, Pages` |

Полное описание поверхности `window.sb` — в
[`booster-framework/docs/`](../booster-framework/docs/README.md).

## Документация

- [`docs/contributing.md`](./docs/contributing.md) — code style,
  test discipline, PR-процесс.
- [`docs/release-process.md`](./docs/release-process.md) — тегирование,
  релиз-pipeline, как injector подцепляет новые версии.

## Для авторов сторонних плагинов

**НЕ добавляйте свой плагин в этот монорепозиторий.** Внешние плагины
живут в своих репозиториях. Используйте шаблон
[`booster-plugin-template`](https://github.com/STEAMBALANCE/booster-plugin-template)
и отправьте URL собранного бандла через portal-форму для approval'a.
Approval-процесс описан в
[`booster-framework/docs/getting-started.md`](../booster-framework/docs/getting-started.md).

## Контрибьюторам

PR'ы приветствуются для:

- Bug fixes в существующих плагинах.
- Документация и тесты.
- Performance-улучшения с измерениями.

Не принимаются:

- **Новые плагины** (живут в собственных репозиториях, см. выше).
- **Breaking-изменения** API одностороннего направления без обсуждения
  через issue первым шагом.
- **Cosmetic-refactor'ы** без bug fix / test / doc — review-cost
  непропорционально.

Подробности процесса — в
[`docs/contributing.md`](./docs/contributing.md).

## Repo layout

```
booster-plugins/
├── packages/
│   ├── booster-checkout/      # Main-context popup-плагин
│   └── booster-addfunds/      # Web-context page-mod плагин
├── tools/                # Shared build helpers
├── docs/
│   ├── contributing.md
│   └── release-process.md
├── package.json          # Bun workspaces корень
├── tsconfig.json
└── README.md             # (this file)
```

## Build / test

```pwsh
cd booster-plugins
bun install
bun run build          # --filter '*' build по всем packages/
bun run test           # тесты по всем packages/ (per-package bunfig)
```

`bun run test` прогоняет каждый пакет в его собственной директории —
бар `bun test` из корня монорепо пропускает per-package `bunfig.toml`
(preload `bun-plugin-svelte`), и Svelte-тесты падают с `$state is not defined`.
Каждый пакет также имеет локальные `bun run build` / `bun test` —
см. соответствующий README.

## Релиз и версии

Версии плагинов хранятся в их `package.json` (`@booster-plugins/booster-checkout`,
`@booster-plugins/booster-addfunds`) и подставляются в манифест автоматически на
этапе релиза — релиз-pipeline оператора читает их оттуда, а
не запрашивает отдельным промптом. Текущий подписанный production-манифест
раздаёт обе версии плагинов; полный flow тегирования и подцепления новых
версий нативным инжектором описан в
[`docs/release-process.md`](./docs/release-process.md).

## License

MIT (см. корневой [`LICENSE`](https://github.com/STEAMBALANCE/booster-framework/blob/main/LICENSE)
у фреймворка). Каждый пакет наследует ту же лицензию.
