import { WebSocketServer } from 'ws';

/**
 * Minimal 2-player room relay. Clients connect to /ws?room=CODE; the first is
 * side 0, the second side 1. Every message is forwarded verbatim to the other
 * player — all game logic lives in the clients.
 */
export function attachRelay(httpServer, path = '/ws') {
  const wss = new WebSocketServer({ noServer: true });
  const rooms = new Map();

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== path) return; // leave Vite's HMR socket alone
    wss.handleUpgrade(req, socket, head, (ws) => join(ws, (url.searchParams.get('room') || '').toUpperCase()));
  });

  function join(ws, code) {
    if (!/^[A-Z0-9]{3,12}$/.test(code)) return ws.close(4000, 'bad room code');
    let room = rooms.get(code);
    if (!room) rooms.set(code, (room = [null, null]));
    const side = !room[0] ? 0 : !room[1] ? 1 : -1;
    if (side < 0) {
      ws.send(JSON.stringify({ t: 'full' }));
      return ws.close(4001, 'room full');
    }
    room[side] = ws;
    const other = () => room[1 - side];
    ws.send(JSON.stringify({ t: 'welcome', side, peer: !!other() }));
    other()?.send(JSON.stringify({ t: 'peer-joined' }));

    ws.on('message', (data) => {
      const o = other();
      if (o && o.readyState === 1) o.send(data.toString());
    });
    ws.on('close', () => {
      if (room[side] === ws) room[side] = null;
      other()?.send(JSON.stringify({ t: 'peer-left' }));
      if (!room[0] && !room[1]) rooms.delete(code);
    });
  }
  return wss;
}
