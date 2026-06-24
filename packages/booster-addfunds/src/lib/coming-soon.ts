// INTERIM kill-switch for the keys-purchase overlay while the real keys API is
// not wired yet. Single source of truth — flip ONE constant to go live.
//
// While true:
//   - normal /app/ page shows the edition-offer chip reduced to just the
//     «Купить» button + a «СКОРО» badge (dimmed), and the topup bar stays
//     visible alongside it;
//   - the region keys-block is hidden by the empty mock in keys-api.ts.
//
// To go LIVE when the API ships:
//   1. set KEYS_COMING_SOON = false;
//   2. replace the empty return in lib/keys-api.ts::fetchRegionKeys with the
//      real fetch (restore from MOCK or wire the endpoint);
//   3. make lib/edition-offer.ts::getEditionOffer return null when the app has
//      no keys (it already returns EditionOffer | null) — that null drives the
//      topup-vs-offer mutual exclusion in pages/app.ts::mountNormal.
//
// To REMOVE the coming-soon state entirely: delete this module and its guards
// (pages/app.ts, components/edition-offer-chip.ts comingSoon option + CSS).
export const KEYS_COMING_SOON = true;
