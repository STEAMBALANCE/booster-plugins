// Public API for booster-checkout plugin code: import { LL } from './i18n';
// Svelte components reach this via '../src/i18n' (App.svelte) or
// '../../src/i18n' (popup-svelte/components/*.svelte).
//
// typesafe-i18n v5.27 exposes two runtime entry points at the package root:
//   - `i18nObject<L,T>(locale, T)` — returns `TranslationFunctions<T>`, a
//     loose type where every leaf is `(...args: any[]) => LocalizedString`.
//   - `typesafeI18nObject<L,T>(locale, T)` — returns `TypedTranslationFunctions<T>`,
//     which preserves per-leaf typed argument shape at the TOP level. But
//     `TypedTranslationFunctions<T>` falls through to the LOOSE
//     `TranslationFunctions<T[key]>` for nested record types (see
//     types/runtime/src/core.d.mts — the recursion is intentionally lost).
//
// Our dict is nested (`checkout.popup.window_title`), so swapping
// `i18nObject` → `typesafeI18nObject` alone is not enough — nested calls
// stay loose. We therefore cast the runtime result through a local
// `Strict<T>` recursive wrapper that re-applies typed-function inference at
// every level. The runtime value is unchanged; only the surfaced type is
// tightened.
//
// A typecheck-only regression test in tests/i18n.typecheck.test.ts
// (run via `bunx tsc --noEmit ...`) guards against future loosening.
import { typesafeI18nObject } from 'typesafe-i18n';
import ru from './generated/messages';

// Recursive strict typing: extracts `{name:string}` / `{name:number}`
// placeholders from each leaf string and produces a typed callable.
type DetectPlaceholders<S> =
  S extends `${string}{${infer Arg}:string}${infer Rest}` ? Record<Arg, string> & DetectPlaceholders<Rest>
  : S extends `${string}{${infer Arg}:number}${infer Rest}` ? Record<Arg, number> & DetectPlaceholders<Rest>
  : Record<never, never>;
type HasPlaceholder<S extends string> = S extends `${string}{${string}}${string}` ? true : false;
type TypedFunction<S extends string> =
  HasPlaceholder<S> extends true
    ? (args: { [K in keyof DetectPlaceholders<S>]: DetectPlaceholders<S>[K] }) => string
    : () => string;
type Strict<T> = {
  [K in keyof T]: T[K] extends string ? TypedFunction<T[K]> : Strict<T[K]>;
};

export const LL = typesafeI18nObject('ru', ru) as unknown as Strict<typeof ru>;
