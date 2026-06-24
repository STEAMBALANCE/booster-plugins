<!-- booster-plugins/packages/booster-checkout/popup-svelte/components/MethodPicker.svelte -->
<script lang="ts">
  import { ICON_CHECK, ICON_CHEVRON_DOWN } from '../lib/icons';
  import type { PaymentMethod } from '../lib/state.svelte';

  interface Props {
    methods: PaymentMethod[];
    selectedType: string;
    open: boolean;
    loading: boolean;        // true while methods are being fetched
    pastThreshold: boolean;  // 300 ms gate from parent (App.svelte $effect)
    onToggle: () => void;
    onSelect: (type: string) => void;
  }
  let { methods, selectedType, open, loading, pastThreshold,
        onToggle, onSelect }: Props = $props();

  // Selected method derived from the array. Defensive fallback to
  // methods[0] when selectedType is stale (shouldn't happen given
  // applyPaymentMethods's sticky logic, but cheap insurance against
  // a race between BC delivery and Svelte's reactive flush).
  let selectedMethod = $derived(
    methods.find(m => m.type === selectedType) ?? methods[0]
  );

  // Loud warning when the methods[0] fallback fires — means
  // applyPaymentMethods's sticky-selection logic let a stale
  // selectedType slip through. Console-warn is fine in production:
  // type names are not PII (they're product names like
  // "paypalych-sbp"), and the line is invaluable if a backend rename
  // ever happens. Side-effect emission via $effect — $derived bodies
  // should stay pure. Skip the empty-methods case (legitimate during
  // initial fetch) and the empty-selectedType case (initial state
  // before the user has selected anything).
  $effect(() => {
    if (methods.length === 0) return;
    const found = methods.find(m => m.type === selectedType);
    if (!found && selectedType !== '') {
      console.warn('[booster-popup] MethodPicker: selectedType', selectedType,
        'not in methods', methods.map(m => m.type));
    }
  });

  function handleClickPicker(e: MouseEvent): void {
    e.stopPropagation();
    onToggle();
  }
  function handleSelect(type: string, e: MouseEvent): void {
    e.stopPropagation();
    onSelect(type);
  }
</script>

<div class="picker">
  <button
    type="button" class="trigger" onclick={handleClickPicker}
    aria-haspopup="menu" aria-expanded={open}
  >
    {#if methods.length === 0 && loading && pastThreshold}
      <span class="icon"><span class="spinner"></span></span>
    {:else if selectedMethod}
      <span class="icon">
        <img src={selectedMethod.imageUrl} alt={selectedMethod.name} />
      </span>
      <span class="name">{selectedMethod.name}</span>
      {#if selectedMethod.badge}
        <span class="badge">{selectedMethod.badge}</span>
      {/if}
    {/if}
    <span class="chevron" class:open>{@html ICON_CHEVRON_DOWN}</span>
  </button>

  {#if open}
    <!-- A11y: Esc-key close + focus restore — see BACKLOG. Outside-click
         already wired via App.svelte's <svelte:document onclick> handler. -->
    <ul class="menu" role="menu">
      {#each methods as method (method.type)}
        <li class="item" class:active={method.type === selectedType} role="none">
          <!-- role="menuitemradio" + aria-checked: this menu picks exactly
               one payment method from a mutually-exclusive set; `menuitem`
               alone does not support aria-checked per WAI-ARIA. -->
          <button type="button" role="menuitemradio"
                  aria-checked={method.type === selectedType}
                  onclick={(e) => handleSelect(method.type, e)}>
            <span class="icon">
              <img src={method.imageUrl} alt={method.name} />
            </span>
            <span class="name">{method.name}</span>
            {#if method.badge}
              <span class="badge">{method.badge}</span>
            {/if}
            {#if method.type === selectedType}
              <span class="check" aria-hidden="true">{@html ICON_CHECK}</span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .picker {
    position: relative; flex: 1; height: 32px;
    min-width: 0;  /* allow flex-shrink so picker doesn't push past
                      AmountRow's 338-wide parent regardless of trigger
                      content width */
  }

  /* Figma 230:107 trigger layout: padding 12 left/right, then
   *   [icon 29] · 8gap · [text 26] · 8gap · [badge 31] · flex-spacer · [chevron 8]
   * → name does NOT flex (auto-width, sits next to icon); chevron uses
   * margin-left: auto to claim the remaining width. Card variant (no
   * badge) collapses to [icon][text][spacer][chevron] and chevron stays
   * pinned right. The width budget fits 165 px parent slot;
   * `.picker { min-width: 0 }` is the actual flex-shrink defense. */
  .trigger {
    display: flex; align-items: center; gap: 8px;
    width: 100%; height: 100%; padding: 0 12px;
    background: var(--booster-surface-2); border: none; cursor: pointer;
    border-radius: var(--booster-radius-sm);
    color: var(--booster-text-primary);
    font: 700 12px/16px var(--booster-font-stack);
    transition: background-color .12s ease;
    /* UA focus ring suppressed; popup is a one-shot brand surface where
     * keyboard navigation is not a primary path. If keyboard affordance
     * becomes required, add `:focus-visible { outline: 2px solid
     * var(--booster-brand-green); outline-offset: -2px; }` rather than
     * reinstating the UA white ring. */
    outline: none;
  }
  .trigger:hover { background: var(--booster-surface-hover); }
  .trigger:focus,
  .trigger:focus-visible { outline: none; }

  /* Figma: icon area 29×14. Pinning explicit width (rather than letting
     the SVG drive it via its intrinsic size) keeps row layout stable
     across any backend-supplied method icon — past, present, or future
     — regardless of native aspect ratio. flex-shrink:0 prevents the
     picker pill (width≈165 inside the 336-wide popup interior:
     378 − 2 border − 40 padding) from squashing the icon below 29 px. */
  .icon {
    display: inline-flex; align-items: center; justify-content: center;
    width: 29px; height: 14px; flex-shrink: 0;
  }
  /* <img> over CDN SVGs: object-fit:contain centers the asset inside
   * the 29×14 box regardless of its native aspect ratio, replacing the
   * previous inlined {@html ...} path for the bundled SBP/Card SVGs.
   * Universal — any future method icon URL the backend returns just
   * works without further code changes. */
  .icon img {
    width: 100%; height: 100%; object-fit: contain; display: block;
  }

  /* Mini-spinner inside the .icon slot when fetch hasn't completed and
   * the 300 ms gate has elapsed. Same 12 px diameter as other popup
   * inline spinners. */
  .spinner {
    width: 12px; height: 12px;
    border: 2px solid var(--booster-surface-3);
    border-top-color: var(--booster-text-primary);
    border-radius: 50%;
    animation: booster-spin .7s linear infinite;
  }
  @keyframes booster-spin { to { transform: rotate(360deg); } }

  .name { white-space: nowrap; }
  .badge {
    background: var(--booster-soon-bg); color: var(--booster-soon-green);
    font: 800 10px/12px var(--booster-font-stack);
    padding: 2px 4px; border-radius: 6px; letter-spacing: 0.02em;
    flex-shrink: 0;
  }
  .chevron {
    display: inline-flex; transition: transform .12s ease;
    margin-left: auto;  /* pushes chevron to right edge so badge clusters
                           with text+icon (Figma 230:107) */
    flex-shrink: 0;
  }
  .chevron :global(svg) { width: 8px; height: 8px; }
  .chevron.open { transform: rotate(180deg); }

  /* Figma 245:347 payment-method-selector: dropdown container is
   * 165 px wide with 4 px rounding, dropped 32 px shadow. Rows sit
   * edge-to-edge inside the rounded container (overflow:hidden clips
   * row backgrounds to the border-radius so first/last row corners
   * stay rounded — same pattern as MenuDropdown).
   *
   * The container background defensively mirrors the unselected-row
   * fill: each .item button paints its own bg covering full width,
   * but if a future change adds vertical padding to .menu OR shrinks
   * a row's width, the .menu background prevents transparent gaps
   * from showing through to whatever sits behind the popup. */
  .menu {
    list-style: none; position: absolute;
    top: 36px; right: 0; width: 100%;
    background: var(--booster-surface-2);
    border-radius: var(--booster-radius-md);
    padding: 0;
    overflow: hidden;
    z-index: 20;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  }
  /* Figma 245:348 (selected row) vs 245:367 (unselected): selected
   * uses --booster-surface-hover (#48505c) as a lit bg + a white check
   * mark on the right, unselected uses --booster-surface-2 (#3d4450)
   * with no mark. Hover on an unselected row lifts to the same
   * --booster-surface-hover so the "actionable" affordance reads as
   * "this would become selected if you click". */
  .item button {
    display: flex; align-items: center; gap: 8px;
    width: 100%; padding: 8px 12px;
    background: var(--booster-surface-2);
    border: none; cursor: pointer;
    color: var(--booster-text-primary);
    font: 700 12px/16px var(--booster-font-stack);
    transition: background-color .12s ease;
    outline: none;
  }
  .item button:focus,
  .item button:focus-visible { outline: none; }
  .item button:hover { background: var(--booster-surface-hover); }
  .item.active button { background: var(--booster-surface-hover); }
  /* Figma 245:366: 8×8 container with an inner 8×6 white check glyph
   * at y=1 (1px top/bottom padding around the path). We size the box
   * to 8×8 and let the SVG's `viewBox="0 0 8 6"` render its 8×6 glyph
   * naturally — `align-items: center` centers the glyph inside the
   * 8×8 box, recreating the Figma 1px padding. Pinned to the right
   * edge of the row (margin-left: auto pushes past name + badge
   * cluster). The SVG ships with `fill="white"` on its path. */
  .check {
    display: inline-flex; align-items: center; justify-content: center;
    width: 8px; height: 8px; margin-left: auto;
    flex-shrink: 0;
  }
  .check :global(svg) { width: 8px; height: 6px; display: block; }
</style>
