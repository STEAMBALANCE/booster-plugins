// Detect a Steam "unavailable in your region" /app/ page. Ground truth (CDP,
// region KZ): the region-locked URL renders Steam's generic error template
// (body.redeemwalletcode, #error_box) with NO product DOM. We require: no
// product template, an #error_box, and the region reason INSIDE #error_box
// ("Ой, извините"/"произошла ошибка" also appear in hidden templates on normal
// pages, so body-wide text is unreliable).
const REGION_PHRASES = ['недоступен в вашем регионе', 'не доступен в вашем регионе']; // strings-allow-cyrillic

export function detectRegionLock(doc: Document): boolean {
  if (doc.querySelector('.apphub_AppName') || doc.querySelector('.game_area_purchase')) return false;
  const errBox = doc.querySelector('#error_box');
  if (!errBox) return false;
  const txt = (errBox.textContent ?? '').toLowerCase();
  return REGION_PHRASES.some((p) => txt.includes(p));
}
