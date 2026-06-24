// Public API for booster-addfunds plugin code: import { LL } from './i18n'.
// booster-addfunds ships no Svelte and no popup UI; the only consumer is the
// plugin's TS code (e.g. src/pages/addfunds.ts).
//
// The dict is flat (addfunds.row_label / submit_button / row_aria_label —
// see generated/messages.ts), so it has no parameterized placeholders today.
// `typesafeI18nObject` already gives per-leaf typed inference at the top
// level; the local `Strict<T>` recursive wrapper re-applies typed-function
// inference through any future nesting. The runtime value is unchanged —
// only the surfaced type is tightened.
//
// tests/i18n.test.ts asserts each accessor returns its Russian string.
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
