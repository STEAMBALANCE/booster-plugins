# Contributing to booster-plugins

Спасибо за интерес к улучшению официальных плагинов `steambooster`. Этот
документ описывает code style, test discipline, и PR-процесс. Перед
тем как открывать PR — прочитайте до конца и убедитесь, что ваш
patch попадает в scope, который мы принимаем (см. ниже).

## Что мы принимаем

- **Bug fixes** в существующих плагинах
  (`packages/booster-checkout`, `packages/booster-addfunds`). Желательно с
  regression-тестом, фиксирующим bug в form red-first перед фиксом.
- **Регрессионные тесты** для уже исправленных багов, найденные при
  чтении кода.
- **Документация** — clarifications, fix'ы опечаток, расширение
  examples.
- **Performance-патчи** с reproducible-measurement (микробенч + цифры
  до / после). Без измерений — close'aem.
- **Тесты на edge cases**, которые сейчас не покрыты.

## Что мы НЕ принимаем

- **Новые плагины.** Внешние плагины живут в своих репозиториях. Используйте
  [`booster-plugin-template`](https://github.com/STEAMBALANCE/booster-plugin-template)
  и submit'те через portal-форму для approval'a.
- **Breaking changes в публичной поверхности.** API внутри
  `apiVersion: 1` — стабилен; любое breaking-изменение проходит через
  bump `apiVersion` и согласуется с framework-репо.
- **Cosmetic refactor'ы** без bug fix / new test / doc — review-cost
  непропорционально пользе.
- **Изменения, обходящие capability-гейтинг или PII-redaction.**
  Безопасность — invariant'ы билда, не feature-flag'и.
- **Massive PR'ы** (> ~500 LOC diff'a, не считая generated/), не
  разбитые на логические части. Сделайте серию маленьких PR'ов.

## Code style

`booster-plugins` следует общим для проекта `steambooster` tsconfig- и
ESLint-настройкам:

- **TypeScript strict.** `noImplicitAny`, `strictNullChecks`,
  `noUncheckedIndexedAccess` — обязательны. Никаких `any` в новом
  коде без `// eslint-disable-next-line` и justification-comment.
- **Imports.** Только top-level `@steambalance/booster-framework`. Subpath
  импорты (`@steambalance/booster-framework/relay/...`) — НЕ публичный API,
  заблокированы linter'ом приёмки.
- **`strings/ru.json` single-source.** Любая user-visible RU-строка
  идёт через generated `LL.*` accessor (`scripts/gen-strings`). Не
  хардкодим Cyrillic в `.ts` файлах вне `*/generated/*` (см. CI
  guard `scripts/tests/no-hardcoded-ru.test.ts` в корне репо).
- **URLs.** Каждый плагин владеет своими бизнес-URL и хранит их в
  `src/urls.ts` (см. канонический пример
  `packages/booster-checkout/src/urls.ts`). Хардкод URL допустим только в
  этом файле; код фреймворка URL не хардкодит.
- **PII redaction.** Не логируем `accountName`, `steamId`, `email`,
  `balance` в production. Dev-only логи — за гейтом
  `__SB_PRODUCTION__` define'ом.
- **`std::expected`-style ошибки.** В TS — `Result<T, string>` или
  `try/catch` на boundary. Не бросаем cross-module.

## Test discipline

`booster-plugins` следует общим test-правилам проекта `steambooster`:

1. **TDD red-first для логики.** Если меняете runtime-поведение —
   сначала пишите red-тест, фиксирующий ожидание, затем код.
2. **Тесты immutable.** Тесты фиксируют intended behavior, не
   текущую реализацию. Red-тест → fix кода, никогда наоборот. Если
   тест нужно отредактировать — это сигнал, что intent поменялся,
   обсудите в PR-описании отдельно.
3. **Регрессии — обязательны.** Bug fix без regression-теста — не
   принимается. Refactor без тестов на покрываемый код —
   обсуждается отдельно (предпочтительно сначала закрыть покрытие).
4. **Никакого test-coverage theater.** Тесты должны фиксировать
   нетривиальные сценарии: gating, ошибки, race-conditions, edge
   cases. Не пишем тестов на «get/set возвращает то, что положили».

Запуск тестов:

```pwsh
# Все плагины:
cd booster-plugins
bun test

# Конкретный пакет:
cd packages/booster-checkout
bun test
```

## PR-процесс

### Перед открытием PR

1. **Issue first для нетривиальных изменений.** Если ваш patch
   меняет публичное поведение, добавляет настройку или
   рефакторит >100 LOC — откройте issue с описанием и подождите
   ответа maintainer'a перед тем, как тратить время на код.
2. **Branch off `main`.** Имя ветки — `fix/<short-desc>`,
   `feat/<short-desc>`, `docs/<short-desc>`, `test/<short-desc>`.
3. **Запустите тесты локально.** `bun test` в корне моноре + в
   изменённом пакете.
4. **Запустите build.** `bun run build` в изменённом пакете; убедитесь,
   что warnings нет и размер бандла не вырос ощутимо.

### Заполните PR-описание

Если в репозитории есть PR-шаблон `.github/PULL_REQUEST_TEMPLATE.md`,
GitHub подставит его автоматически. Если шаблона нет — скопируйте тело
из секции «PR template body» ниже вручную в описание PR.

#### PR template body

```markdown
## Summary

<Одно-два предложения: что меняется, зачем.>

## Change type

- [ ] Bug fix (regression test included)
- [ ] Documentation
- [ ] Performance (measurements included)
- [ ] Test-only (new tests, no behavior change)
- [ ] Refactor (no behavior change, no public-API impact)

## Linked issue

<Closes #N | Refs #N | n/a>

## Testing

- [ ] `bun test` passes in affected package
- [ ] `bun test` passes at monorepo root
- [ ] `bun run build` passes in affected package
- [ ] Manual smoke в живом `steambooster-dev.exe` (если UI-изменение)

## Affected packages

- [ ] `booster-checkout`
- [ ] `booster-addfunds`
- [ ] (другое — указать)

## Capability surface

- [ ] No new capabilities requested in PluginManifest
- [ ] (если новый capability — обосновать в Summary)

## Breaking changes

- [ ] No breaking changes
- [ ] (если breaking — link на discussion / RFC issue)

## Screenshots / screencast (для UI-changes)

<вложение или ссылка>
```

### Code-review

- Maintainer review проходит в течение 1-2 недель (плагины — не
  full-time проект).
- **Все findings** — включая suggestions — обсуждаются перед merge'ом.
  Не «accept'aem» без явного обоснования.
- Maintainer может попросить расщепить PR, добавить тестов или
  поправить commit-историю. Это нормально; история коммитов попадает в
  changelog.
- Любой security-related change уходит дополнительно на
  `security-review` skill — пайплайн занимает дольше.

### Merge

- Squash-merge для feature-PR'ов (один коммит на feature).
- Rebase-merge — для серий маленьких commits, которые имеет смысл
  сохранить как отдельные шаги в истории (refactor + test + fix).
- Tag создаёт maintainer (см. [`release-process.md`](./release-process.md)).
- После merge'a — pull от `main` и удалите вашу ветку.

## Git commit conventions

Conventional commits, scoped по пакету:

```
fix(booster-checkout): popup не закрывается при ESC
feat(booster-addfunds): pre-fill валюты из user.currency
docs(booster-plugins): contributing.md initial draft
test(booster-checkout): payment-methods filter regressions
refactor(booster-addfunds): extract currency-map в lib/
chore(booster-plugins): bump bun-types
```

Body — императив, кратко описывает «почему», не «что» (это видно в
diff'е). Trailer `Co-Authored-By:` — обязателен для PR'ов от AI-tooling.

## Локальный setup

Монорепо `booster-plugins` резолвит зависимость
`@steambalance/booster-framework` через `file:../booster-framework`.
Поэтому публичный репозиторий `booster-framework` должен быть склонирован
рядом, как соседний каталог:

```pwsh
# Раскладка: оба репозитория лежат рядом в одном рабочем каталоге.
git clone git@github.com:STEAMBALANCE/booster-framework.git booster-framework
git clone git@github.com:STEAMBALANCE/booster-plugins.git   booster-plugins

cd booster-plugins
bun install
bun test            # baseline должен быть зелёным
```

Если `bun install` падает с `Cannot find package '@steambalance/booster-framework'`
— проверьте, что репозиторий `booster-framework` лежит рядом по пути
`../booster-framework` относительно `booster-plugins`.

## Questions

- Issue в `STEAMBALANCE/booster-plugins` — для багов / feature requests
  по официальным плагинам.
- Issue в `STEAMBALANCE/booster-framework` — для API-вопросов.

Спасибо за contribution.
