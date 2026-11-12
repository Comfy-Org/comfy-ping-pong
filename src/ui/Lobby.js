import { NetSession } from '../net/NetSession.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const newCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

/** Start menu: play the computer, host an online room, or join one by code/link. */
export class Lobby {
  constructor(root, game) {
    this.game = game;
    this.el = document.createElement('div');
    this.el.className = 'lobby';
    root.appendChild(this.el);
  }

  showMenu(error = '') {
    this.el.hidden = false;
    this.el.innerHTML = `
      <div class="card">
        <h1>Matt <span>vs</span> Deep</h1>
        ${error ? `<p class="err">${error}</p>` : ''}
        <button data-a="ai" class="primary">Play the computer</button>
        <button data-a="host">Host an online match</button>
        <form class="join"><input name="code" placeholder="Room code" maxlength="8" autocomplete="off" /><button>Join</button></form>
      </div>`;
    this.el.querySelector('[data-a=ai]').onclick = () => this.playAI();
    this.el.querySelector('[data-a=host]').onclick = () => this.connect(newCode());
    this.el.querySelector('form').onsubmit = (e) => {
      e.preventDefault();
      const code = e.target.code.value.trim().toUpperCase();
      if (code) this.connect(code);
    };
  }

  hide() {
    this.el.hidden = true;
  }

  playAI() {
    this.hide();
    history.replaceState(null, '', location.pathname);
    this.game.setDemo(false);
    this.game.resetMatch();
  }

  connect(code) {
    history.replaceState(null, '', `?room=${code}`);
    this._panel(`<p>Connecting to room <b>${code}</b>…</p>`);
    const net = new NetSession(code);
    let started = false;
    const start = (side, sendStart) => {
      started = true;
      this.hide();
      this.game.setDemo(false);
      this.game.goOnline(net, side);
      if (sendStart) {
        net.send({ t: 'start' });
        this.game.resetMatch();
      }
    };
    net.on('welcome', (m) => {
      if (m.peer) start(m.side, false); // opponent is already waiting; they'll send 'start'
      else this._waiting(code, m.side);
    });
    net.on('peer-joined', () => !started && start(net.side, true));
    net.on('full', () => this.showMenu(`Room ${code} already has two players.`));
    net.on('close', () => !started && this.showMenu(`Couldn't connect to room ${code}.`));
  }

  async _waiting(code, side) {
    const local = /^(localhost|127\.|\[::1\])/.test(location.hostname);
    // On localhost, prefer the tailnet address (if `npm run tailnet` is on) so the link works remotely.
    let base = location.origin;
    let shared = !local;
    if (local) {
      try {
        const { origin } = await (await fetch('/__share-origin')).json();
        if (origin) [base, shared] = [origin, true];
      } catch {}
    }
    const link = `${base}${location.pathname}?room=${code}`;
    const you = this.game.players[side].def.name;
    this._panel(`
      <p>Room <b class="code">${code}</b> · you'll play as ${you}</p>
      <div class="link"><input readonly value="${link}" /><button data-a="copy">Copy</button></div>
      <p class="hint">${
        shared
          ? base.endsWith('.ts.net') || base.includes('.ts.net:') ? 'Tailnet link: your opponent needs to be on your Tailscale network.' : ''
          : 'This link only works on this computer. Run <code>npm run tailnet</code> to get a link that works on your Tailscale network.'
      }</p>
      <p class="wait">Waiting for your opponent…</p>`);
    this.el.querySelector('[data-a=copy]').onclick = (e) => {
      navigator.clipboard?.writeText(link);
      e.target.textContent = 'Copied';
    };
  }

  _panel(html) {
    this.el.hidden = false;
    this.el.innerHTML = `<div class="card">${html}<button data-a="back" class="ghost">Back</button></div>`;
    this.el.querySelector('[data-a=back]').onclick = () => {
      this.game.goOffline();
      location.search ? (location.href = location.pathname) : this.showMenu();
    };
  }
}
