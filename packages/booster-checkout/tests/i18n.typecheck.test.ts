// This file verifies that LL.checkout.* enforces per-key argument types.
// It is a TYPECHECK-ONLY test — bun test does not need to execute it; the
// guard is `bunx tsc --noEmit booster-plugins/packages/booster-checkout/tests/i18n.typecheck.test.ts`.
//
// If typesafe-i18n is downgraded from `typesafeI18nObject` to `i18nObject`
// (the loose form), every `@ts-expect-error` comment below becomes an
// "Unused '@ts-expect-error' directive" diagnostic and tsc exits non-zero,
// surfacing the regression.
import { LL } from '../src/i18n';

// @ts-expect-error — window_title requires { login: string }
LL.checkout.popup.window_title({});

// @ts-expect-error — wrong key name (user vs login)
LL.checkout.popup.window_title({ user: 'x' });

// @ts-expect-error — button_label takes no arguments
LL.checkout.popup.button_label({ extra: 1 });

// @ts-expect-error — window_title requires the argument
LL.checkout.popup.window_title();

// Positive controls (these SHOULD compile):
const valid1: string = LL.checkout.popup.window_title({ login: 'matrix' });
const valid2: string = LL.checkout.popup.button_label();

export { valid1, valid2 };
