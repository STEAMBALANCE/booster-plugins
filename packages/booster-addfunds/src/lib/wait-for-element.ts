// Wait for the first element matching `selector` to appear in the DOM.
// Resolves the element (or null on timeout / abort) — never rejects.
export async function waitForElement<T extends HTMLElement>(
  selector: string,
  signal: AbortSignal,
  timeoutMs = 5000,
): Promise<T | null> {
  if (signal.aborted) return null;
  const existing = document.querySelector<T>(selector);
  if (existing) return existing;
  return new Promise<T | null>((resolve) => {
    let done = false;
    const finish = (val: T | null): void => {
      if (done) return;
      done = true;
      observer.disconnect();
      clearTimeout(timer);
      resolve(val);
    };
    const observer = new MutationObserver(() => {
      const el = document.querySelector<T>(selector);
      if (el) finish(el);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    const timer = setTimeout(() => finish(null), timeoutMs);
    signal.addEventListener('abort', () => finish(null), { once: true });
  });
}

// Resolve when `predicate()` returns a non-null element (or null on timeout/abort).
// Like waitForElement but for matches that can't be expressed as a single selector.
export async function waitForElementBy<T extends HTMLElement>(
  predicate: () => T | null,
  signal: AbortSignal,
  timeoutMs = 5000,
): Promise<T | null> {
  if (signal.aborted) return null;
  const existing = predicate();
  if (existing) return existing;
  return new Promise<T | null>((resolve) => {
    let done = false;
    const finish = (val: T | null): void => {
      if (done) return;
      done = true;
      observer.disconnect();
      clearTimeout(timer);
      resolve(val);
    };
    const observer = new MutationObserver(() => { const el = predicate(); if (el) finish(el); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    const timer = setTimeout(() => finish(null), timeoutMs);
    signal.addEventListener('abort', () => finish(null), { once: true });
  });
}
