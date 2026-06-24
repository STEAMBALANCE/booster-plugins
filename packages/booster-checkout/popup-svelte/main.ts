// booster-plugins/packages/booster-checkout/popup-svelte/main.ts
//
// Entry point for the Svelte popup bundle. The bundler (build-popup.ts)
// uses this file as the entrypoint and inlines the resulting JS into the
// popup HTML's <script> block. Mounts <App> into #root which the wrapper
// HTML provides as an empty <div id="root"></div>.
//
// initBridge() runs BEFORE mount so the BroadcastChannel subscriber is
// installed in time to catch the very first init/email message — main
// shell may post these synchronously after attach-popup so any window
// of unsubscribed time risks dropping the seed.
import { mount } from 'svelte';
import App from './App.svelte';
import { initBridge } from './lib/bridge';

initBridge();
const target = document.getElementById('root');
if (!target) throw new Error('booster-popup: #root element missing — wrapper HTML changed');
mount(App, { target });
