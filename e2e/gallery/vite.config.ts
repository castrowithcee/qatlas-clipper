// Standalone dev server for the component gallery (screenshots only). It is not a WXT entrypoint and never part of any extension build.
export default {
  root: import.meta.dirname,
  esbuild: { jsx: 'automatic' },
  server: { host: '127.0.0.1', port: 5179, strictPort: true },
};
