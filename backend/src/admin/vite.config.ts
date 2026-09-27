import { resolve } from 'node:path';

export default (config) => ({
  ...config,
  build: {
    ...config.build,
    rollupOptions: {
      ...config.build?.rollupOptions,
      input: { ...config.build?.rollupOptions?.input, 'pages-session': resolve(__dirname, 'pages-session.html') },
    },
  },
  plugins: [...config.plugins, {
    name: 'pages-session-html',
    generateBundle: { order: 'post', handler(_, bundle) {
      for (const [key, output] of Object.entries(bundle) as [string, any][]) {
        if (output.type === 'asset' && key.endsWith('pages-session.html')) {
          delete bundle[key];
          output.fileName = 'pages-session.html';
          bundle[output.fileName] = output;
        }
      }
    } },
  }],
});
