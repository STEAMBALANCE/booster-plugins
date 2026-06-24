// booster-plugins/packages/booster-checkout/popup-svelte/lib/icons.ts
//
// Inline SVG/asset strings, инжектятся как `define` константы build-time
// из booster-plugins/packages/booster-checkout/scripts/build-popup.ts. На этом уровне — только TS
// declarations + re-export, чтобы Svelte компоненты могли импортировать
// typed constants.

declare const __SB_ICON_BOX__:           string;
declare const __SB_ICON_CHECK__:         string;
declare const __SB_ICON_CHEVRON_DOWN__:  string;
declare const __SB_ICON_CLOSE__:         string;
declare const __SB_ICON_DOCUMENT__:      string;
declare const __SB_ICON_FAQ__:           string;
declare const __SB_ICON_GEAR__:          string;
declare const __SB_ICON_SAFETY__:        string;
declare const __SB_ICON_SETTINGS__:      string;
declare const __SB_ICON_SUPPORT__:       string;
declare const __SB_ICON_TELEGRAM__:      string;
declare const __SB_IMG_LOGO_DATA_URI__:  string;

// Consumers:
//   Footer       → ICON_SAFETY
//   MethodPicker → ICON_CHEVRON_DOWN (trigger), ICON_CHECK (selected-row mark)
//                  method icons load from CDN via <img>
//   Header       → ICON_GEAR, ICON_CHEVRON_DOWN, IMG_LOGO_DATA_URI
//   MenuDropdown → ICON_SUPPORT, ICON_BOX, ICON_SETTINGS, ICON_DOCUMENT, ICON_FAQ, ICON_TELEGRAM
//   booster-plugins/packages/booster-checkout/src/index.ts → IMG_LOGO_DATA_URI (via addHeaderButton({icon}))
// Keep all exports — they form a single asset entry-point used across
// popup-svelte and main-shell-side code.
export const ICON_BOX          = __SB_ICON_BOX__;
export const ICON_CHECK        = __SB_ICON_CHECK__;
export const ICON_CHEVRON_DOWN = __SB_ICON_CHEVRON_DOWN__;
export const ICON_CLOSE        = __SB_ICON_CLOSE__;
export const ICON_DOCUMENT     = __SB_ICON_DOCUMENT__;
export const ICON_FAQ          = __SB_ICON_FAQ__;
export const ICON_GEAR         = __SB_ICON_GEAR__;
export const ICON_SAFETY       = __SB_ICON_SAFETY__;
export const ICON_SETTINGS     = __SB_ICON_SETTINGS__;
export const ICON_SUPPORT      = __SB_ICON_SUPPORT__;
export const ICON_TELEGRAM     = __SB_ICON_TELEGRAM__;
export const IMG_LOGO_DATA_URI = __SB_IMG_LOGO_DATA_URI__;
