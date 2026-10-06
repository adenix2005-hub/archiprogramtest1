// Entry point.
import { App } from './app.js';

function start() {
  const root = document.getElementById('root');
  try {
    const app = new App();
    app.init(root);
    window.lintel = app; // handy for debugging from the console
  } catch (err) {
    console.error(err);
    root.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'splash';
    box.innerHTML = '<strong>LINTEL</strong><span>Something went wrong while starting. Reload the page to try again.</span>';
    root.append(box);
  }
}

start();

// Offline support when served over http(s) (not available in embedded previews).
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !window.__LINTEL_NO_SW__) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) window.lintel?.toast('Lintel was updated. Reload the page to use the new version.', 8000);
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      /* offline mode unavailable */
    });
  });
}
