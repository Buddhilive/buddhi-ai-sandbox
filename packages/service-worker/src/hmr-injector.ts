/**
 * Injects virtual WebSocket client into preview HTML documents for Next.js HMR
 */

export const HMR_CLIENT_POLYFILL = `
<script>
(() => {
  if (typeof window === 'undefined') return;
  const OriginalWebSocket = window.WebSocket;

  window.WebSocket = function(url, protocols) {
    if (typeof url === 'string' && (url.includes('_next/webpack-hmr') || url.includes('/_next/hmr'))) {
      const target = new EventTarget();
      const channel = new MessageChannel();

      target.readyState = 0; // CONNECTING
      target.url = url;

      channel.port1.onmessage = (event) => {
        if (target.readyState === 0) {
          target.readyState = 1; // OPEN
          if (target.onopen) target.onopen(new Event('open'));
          target.dispatchEvent(new Event('open'));
        }
        const msgEvent = new MessageEvent('message', { data: event.data });
        if (target.onmessage) target.onmessage(msgEvent);
        target.dispatchEvent(msgEvent);
      };

      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: 'ws:connect',
          url,
        }, [channel.port2]);
      }

      target.send = (data) => {
        channel.port1.postMessage(data);
      };

      target.close = (code, reason) => {
        target.readyState = 3;
        channel.port1.close();
        if (target.onclose) target.onclose(new CloseEvent('close', { code, reason }));
        target.dispatchEvent(new CloseEvent('close', { code, reason }));
      };

      setTimeout(() => {
        if (target.readyState === 0) {
          target.readyState = 1;
          if (target.onopen) target.onopen(new Event('open'));
          target.dispatchEvent(new Event('open'));
        }
      }, 50);

      return target;
    }
    return new OriginalWebSocket(url, protocols);
  };
})();
</script>
`;

export function injectHmrPolyfill(html: string): string {
  if (html.includes('</head>')) {
    return html.replace('</head>', `${HMR_CLIENT_POLYFILL}</head>`);
  }
  return HMR_CLIENT_POLYFILL + html;
}
