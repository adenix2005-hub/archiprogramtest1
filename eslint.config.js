// Lint config: `npx eslint js tests tools`
export default [
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        window: 'readonly', document: 'readonly', navigator: 'readonly', console: 'readonly',
        localStorage: 'readonly', performance: 'readonly', requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
        setInterval: 'readonly', clearInterval: 'readonly', getComputedStyle: 'readonly',
        ResizeObserver: 'readonly', MutationObserver: 'readonly', matchMedia: 'readonly', Blob: 'readonly', URL: 'readonly',
        FileReader: 'readonly', Image: 'readonly', HTMLElement: 'readonly', KeyboardEvent: 'readonly',
        PointerEvent: 'readonly', DOMParser: 'readonly', structuredClone: 'readonly', self: 'readonly',
        Node: 'readonly', Event: 'readonly', CustomEvent: 'readonly', XMLSerializer: 'readonly', btoa: 'readonly', atob: 'readonly',
        HTMLCanvasElement: 'readonly', OffscreenCanvas: 'readonly', WebGLRenderingContext: 'readonly', getSelection: 'readonly',
        caches: 'readonly', fetch: 'readonly', location: 'readonly', history: 'readonly',
        process: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly', Response: 'readonly', DataView: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none' }],
      'no-undef': 'error',
    },
  },
];
