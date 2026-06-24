<!-- booster-plugins/packages/booster-checkout/popup-svelte/components/InfoRow.svelte -->
<script lang="ts">
  interface Props {
    label: string;            // "Логин:" / "Получите:"
    value: string;            // "username" / "100 ₽"
  }
  let { label, value }: Props = $props();
</script>

<div class="row">
  <span class="label">{label}</span>
  <span class="dots"></span>
  <span class="value">{value}</span>
</div>

<style>
  /* Figma 245:324 + 245:330 + 245:327: label ("Логин:" / "Получите:")
   * and the dotted leader are at 50% opacity (secondary chrome), the
   * value on the right is at full opacity (primary content the user
   * scans for). Applying opacity per-element rather than on .row keeps
   * the value pure white instead of dimmed.
   *
   * Weight: all three Figma text nodes (label + value) specify
   * `fontWeight="500"` (Motiva Sans Medium), hence the unified Medium
   * weight on label AND value. Steam's runtime substitutes 500 → 400
   * (see tokens.css typography comment); the design intent is still
   * captured in the source. */
  .row {
    display: flex; align-items: center;
    height: 16px; gap: 4px;
  }
  .label {
    font: var(--booster-fw-medium) 12px/16px var(--booster-font-stack);
    color: var(--booster-text-primary);
    flex-shrink: 0;
    opacity: 0.5;
  }
  .value {
    font: var(--booster-fw-medium) 12px/16px var(--booster-font-stack);
    color: var(--booster-text-primary);
    flex-shrink: 0;
  }
  .dots {
    flex: 1;
    height: 2px;
    /* True dotted leader (per Figma): radial-gradient circles, repeated. */
    background-image: radial-gradient(circle, currentColor 1px, transparent 1px);
    background-size: 4px 2px;
    background-repeat: repeat-x;
    color: var(--booster-text-primary);
    opacity: 0.5;
    margin: 0 4px;
    align-self: end;
    margin-bottom: 4px;
  }
</style>
