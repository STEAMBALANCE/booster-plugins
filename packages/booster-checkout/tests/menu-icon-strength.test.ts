//
// Regression guard for the popup menu (MenuDropdown.svelte): the menu owns
// idle-dimming of row content in CSS (`.icon{opacity:.5}` → 1 on hover), so
// every menu-row icon SVG must ship at FULL strength. The reference rows
// «Мои заказы» (box) and «Поддержка» (support) were always full-strength;
// telegram/document/faq used to bake in their own `opacity="0.5"`, which
// stacked on top of the CSS dim (0.5 × 0.5) and made those rows look duller
// than the rest. Keep the icon sources uniform so the CSS layer is the
// single source of truth for menu dimming.
//
import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Icons rendered by MenuDropdown.svelte rows (gear is header-only, excluded).
const MENU_ICON_FILES = [
  'box.svg',       // Мои заказы (reference)
  'support.svg',   // Поддержка  (reference)
  'telegram.svg',
  'document.svg',  // Условия + Конфиденциальность
  'faq.svg',
  'settings.svg',
];

const ICON_DIR = resolve(import.meta.dir, '../assets/icons');

test('menu-row icons ship full-strength (no baked opacity, white fill)', () => {
  for (const file of MENU_ICON_FILES) {
    const svg = readFileSync(resolve(ICON_DIR, file), 'utf-8');
    // No baked opacity — the menu CSS owns idle-dimming.
    expect(svg).not.toContain('opacity');
    // Painted full-strength white. A gray/hex fill would dim the row the
    // same way baked opacity did, slipping past the opacity check above.
    expect(svg).toContain('fill="white"');
    expect(svg).not.toMatch(/fill="#/);
  }
});
