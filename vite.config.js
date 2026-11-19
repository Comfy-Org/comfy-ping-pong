import { defineConfig } from 'vite';
import { execFile } from 'node:child_process';
import { attachRelay } from './server/relay.js';

// Extra hostnames the dev server answers to: Tailscale (tailnet-only HTTPS via `npm run tailnet`)
// plus common tunnel services. Vite itself stays bound to localhost.
const tunnelHosts = ['.ts.net', '.trycloudflare.com', '.ngrok-free.app', '.ngrok.app'];

/**
 * GET /__share-origin → { origin } — the `tailscale serve` HTTPS address that proxies to this
 * server, so a host playing on localhost can hand out a link that works on the tailnet.
 */
function shareOrigin(server) {
  server.middlewares.use('/__share-origin', (req, res) => {
    const port = server.httpServer.address()?.port;
    execFile('tailscale', ['serve', 'status', '--json'], { timeout: 3000 }, (err, stdout) => {
      let origin = null;
      try {
        const web = JSON.parse(stdout || '{}').Web ?? {};
        for (const [hostPort, cfg] of Object.entries(web)) {
          const proxies = Object.values(cfg.Handlers ?? {}).map((h) => h.Proxy ?? '');
          if (proxies.some((p) => /\/\/(127\.0\.0\.1|localhost):(\d+)/.exec(p)?.[2] === String(port))) {
            origin = `https://${hostPort.replace(/:443$/, '')}`;
          }
        }
      } catch {}
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ origin }));
    });
  });
}

// The office TV plays the purz.tv channel. purz.tv can't be framed and its clips have no CORS
// headers, so the game fetches the manifest and clips through this same-origin proxy instead
// (WebGL can only use video it's allowed to read).
const proxy = {
  '/purz': {
    target: 'https://purz.tv',
    changeOrigin: true,
    rewrite: (p) => p.replace(/^\/purz/, ''),
  },
};

export default defineConfig({
  // IPv4 loopback explicitly: `tailscale serve` proxies to 127.0.0.1, and plain "localhost" can bind ::1 only.
  server: { host: '127.0.0.1', allowedHosts: tunnelHosts, proxy },
  preview: { host: '127.0.0.1', allowedHosts: tunnelHosts, proxy },
  plugins: [
    {
      name: 'pingpong-relay',
      configureServer(server) {
        attachRelay(server.httpServer);
        shareOrigin(server);
      },
      configurePreviewServer(server) {
        attachRelay(server.httpServer);
        shareOrigin(server);
      },
    },
  ],
});
