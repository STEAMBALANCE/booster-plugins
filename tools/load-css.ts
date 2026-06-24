// Shared CSS loader for plugin builds. Reads a .css file and, when `minify`
// is set (production), runs it through Bun's built-in CSS minifier — strips
// comments + whitespace and collapses to a single line. Dev keeps the source
// readable for debugging the injected <style> in Steam DevTools.
import { readFileSync } from 'node:fs';

export async function loadCss(path: string, minify: boolean): Promise<string> {
  if (!minify) return readFileSync(path, 'utf8');
  const res = await Bun.build({ entrypoints: [path], minify: true });
  if (!res.success) {
    for (const m of res.logs) console.error(m);
    throw new Error(`CSS minify failed: ${path}`);
  }
  return (await res.outputs[0]!.text()).trimEnd();
}
