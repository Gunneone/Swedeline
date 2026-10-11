// The build imports CSS files as text (esbuild loader "text").
declare module '*.css' {
  const text: string;
  export default text;
}
