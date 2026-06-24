// `import css from './x.css' with { type: 'text' }` yields the raw stylesheet
// as a string (bun's text loader). Ambient declaration for editor/typecheck;
// bun resolves the import at build/runtime regardless.
declare module '*.css' {
  const content: string;
  export default content;
}
