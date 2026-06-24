// Single source of truth for the plugin's eligibility urlPatterns. Imported by
// BOTH index.ts (the sb.plugins.register bundle metadata) and plugin-meta.ts
// (which the build emits into the manifest sidecar). The framework's
// crossValidate requires bundle.urlPatterns ⊆ manifest.urlPatterns by STRING
// equality, so these two lists must be byte-identical — sharing one constant
// makes drift impossible.
//
// Trailing `([/?#].*)?$` (not `(/.*)?$`): the framework checks eligibility ONCE
// at bootstrap against location.href. Steam opens an /app/ page reached from the
// store home at `app/<id>?snr=...` — a query string BEFORE the SEO slug is added
// client-side — so the pattern must accept a `?` or `#` (not only `/`) right
// after the path. Without this, such pages fail the gate and the plugin (topup
// bar + keys offer) never mounts. See tests/url-patterns.test.ts.
export const ADDFUNDS_URL_PATTERNS: string[] = [
  '^https://store\\.steampowered\\.com/steamaccount/addfunds([/?#].*)?$',
  '^https://store\\.steampowered\\.com/app/\\d+([/?#].*)?$',
  '^https://store\\.steampowered\\.com/cart/?($|\\?|#)',
];
