import { Sandbox } from '@buddhilive/sandbox';

export async function setupPreviewDemo(sandbox: Sandbox, iframeEl: HTMLIFrameElement) {
  sandbox.ports.on('listen', ({ port, url }) => {
    console.log(`Port ${port} opened! Preview URL: ${url}`);
    iframeEl.src = url;
  });

  sandbox.ports.on('close', ({ port }) => {
    console.log(`Port ${port} closed.`);
  });
}
