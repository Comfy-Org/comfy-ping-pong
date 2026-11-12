/** WebSocket connection to the room relay, with RTT measurement. */
export class NetSession {
  constructor(room) {
    this.room = room;
    this.side = null;
    this.rtt = 0; // seconds, measured peer-to-peer through the relay
    this.closed = false;
    this.handlers = {};
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws?room=${encodeURIComponent(room)}`);
    this.ws.onopen = () => this._emit('open', {});
    this.ws.onclose = () => {
      this.closed = true;
      clearInterval(this._ping);
      this._emit('close', {});
    };
    this.ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t === 'ping') return this.send({ t: 'pong', ts: m.ts });
      if (m.t === 'pong') {
        const sample = (performance.now() - m.ts) / 1000;
        this.rtt = this.rtt ? this.rtt * 0.7 + sample * 0.3 : sample;
        return this._emit('rtt', this.rtt);
      }
      if (m.t === 'welcome') this.side = m.side;
      this._emit(m.t, m);
    };
    this._ping = setInterval(() => this.send({ t: 'ping', ts: performance.now() }), 1000);
  }

  on(type, fn) {
    (this.handlers[type] ??= []).push(fn);
  }

  _emit(type, m) {
    this.handlers[type]?.forEach((fn) => fn(m));
  }

  send(obj) {
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  close() {
    this.closed = true;
    clearInterval(this._ping);
    this.ws.close();
  }
}
