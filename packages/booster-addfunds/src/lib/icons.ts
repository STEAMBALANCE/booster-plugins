// Shared inline SVG marks for store-page components (plain DOM, no Svelte).
// Extracted from keys-block.ts so the region keys block AND the edition offer
// chip render the same vectors.

// SteamBalance swirl, shown inside the buy button. Path traced from
// the project design system (keys-for-region == distribution vector),
// viewBox 14x12.
export const SB_SWIRL_SVG =
  '<svg viewBox="0 0 14 12" width="14" height="12" aria-hidden="true"><path fill="currentColor" d="M0 4.3654C0 1.9544 1.8431 0 4.1166 0L8.1751 0 6.7887 2.3077 4.1166 2.3077C3.0449 2.3077 2.1762 3.2289 2.1762 4.3654 2.1762 5.5018 3.0449 6.4231 4.1166 6.4231L8.0354 6.4231 4.6850 12 2.1048 12 4.0690 8.7305C1.8174 8.7034 0 6.7595 0 4.3654Z M9.8834 5.5769C10.9551 5.5769 11.8238 6.4982 11.8238 7.6346 11.8238 8.7710 10.9551 9.6923 9.8834 9.6923L7.2102 9.6923 5.8238 12 9.8834 12C12.1569 12 14 10.0455 14 7.6346 14 5.2401 12.1820 3.2960 9.9300 3.2695L11.8941 0 9.3139 0 5.9635 5.5769 9.8834 5.5769Z"/></svg>';

// Static Windows platform icon (top-right of region key rows).
export const WINDOWS_SVG =
  '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="M3 5.1 10 4v8H3V5.1zM10 12.9V21l-7-1.1V12.9H10zM11.2 3.8 21 2v9.9l-9.8.1V3.8zM21 13.1V23l-9.8-1.4V13H21z"/></svg>';

// Thin close (×) mark for the modal corner button.
export const CLOSE_SVG =
  '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M1.4.3.3 1.4 4.9 6 .3 10.6l1.1 1.1L6 7.1l4.6 4.6 1.1-1.1L7.1 6l4.6-4.6L10.6.3 6 4.9z"/></svg>';
