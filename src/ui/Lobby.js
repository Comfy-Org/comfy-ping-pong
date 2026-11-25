import { NetSession } from '../net/NetSession.js';
import { ROSTER, PICKS, lineupFor } from '../characters/roster.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const newCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

const pickKey = 'character';
/** The character id you picked last time (older saves stored a side: '0' Matt, '1' Deep). */
export const loadPick = () => {
  try {
    const v = localStorage.getItem(pickKey);
    if (v === '1') return 'deep';
    return PICKS.includes(v) ? v : 'matt';
  } catch {
    return 'matt';
  }
};

/**
 * Start menu: pick your character, then walk into the office (the computer is
 * around for ping pong and chess), host an online room, or join one by code/link.
 */
export class Lobby {
  constructor(root, game) {
    this.game = game;
    this.pick = loadPick(); // a character id (see PICKS)
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
        <p class="label">Choose your character</p>
        <div class="chars">${PICKS.map((id) => ROSTER[id])
          .map(
            (d) => `<button type="button" class="char${d.id === this.pick ? ' on' : ''}" data-id="${d.id}" style="--c:#${d.color.toString(16).padStart(6, '0')}">
              <i>${d.name[0]}</i><b>${d.name}</b><small>${d.handedness}-handed</small></button>`
          )
          .join('')}</div>
        <button data-a="ai" class="primary">Enter the office</button>
        <label class="toggle"><input type="checkbox" data-a="narr" ${this.game.narrator?.on ? 'checked' : ''}/> Narrator <kbd>C</kbd></label>
        <button data-a="host">Host an online game</button>
        <form class="join"><input name="code" placeholder="Room code" maxlength="8" autocomplete="off" /><button>Join</button></form>
      </div>`;
    this.el.querySelectorAll('.char').forEach((b) => {
      b.onclick = () => {
        this.pick = b.dataset.id;
        try {
          localStorage.setItem(pickKey, this.pick);
        } catch {}
        this.el.querySelectorAll('.char').forEach((x) => x.classList.toggle('on', x === b));
      };
    });
    const narr = this.el.querySelector('[data-a=narr]');
    narr.onchange = () => this.game.narrator?.setOn(narr.checked, { quiet: true });
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

  /** True if the table already has your pick's two players; otherwise reloads with them. */
  _ensureLineup() {
    const want = lineupFor(this.pick);
    if (want.characters.map((c) => c.id).join(',') === this.game.lineup) return want.side;
    try {
      sessionStorage.setItem('autoEnter', '1');
    } catch {}
    location.reload();
    return null;
  }

  playAI() {
    const side = this._ensureLineup();
    if (side === null) return;
    this.hide();
    history.replaceState(null, '', location.pathname);
    const g = this.game;
    g.setDemo(false);
    g.setLocalSide(side);
    g.resetMatch();
    this._intoOffice();
  }

  /** Everyone starts out walking around the office; the ping-pong table is one of the spots. */
  _intoOffice() {
    const g = this.game;
    g.explore.enter({ start: true });
    g.hud.message(`You're ${g.players[g.localSide].def.name}`, 'Walk with WASD · F at a table to play', 3);
  }

  connect(code, tries = 0) {
    history.replaceState(null, '', `?room=${code}`);
    this._panel(`<p>Connecting to room <b>${code}</b>…</p>`);
    // Online play is Matt vs Deep for now (both ends need the same two characters).
    const net = new NetSession(code, this.pick === 'deep' ? 1 : 0);
    let started = false;
    const start = (side, sendStart) => {
      if (started) return;
      started = this._started = true;
      this.hide();
      this.game.setDemo(false);
      this.game.goOnline(net, side);
      if (sendStart) {
        net.send({ t: 'start' });
        this.game.resetMatch();
      }
      this._intoOffice();
    };
    net.on('welcome', (m) => {
      if (m.peer) start(m.side, false); // opponent is already waiting; they'll send 'start'
      else this._waiting(code, m.side);
    });
    net.on('peer-joined', () => !started && start(net.side, true));
    // Right after a reload the old connection can still hold our seat for a moment: retry.
    net.on('full', () => (tries < 4 ? setTimeout(() => this.connect(code, tries + 1), 800) : this.showMenu(`Room ${code} already has two players.`)));
    net.on('close', () => !started && !net.full && this.showMenu(`Couldn't connect to room ${code}.`));
    net.on('full', () => (net.full = true));
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
    if (this._started) return; // they joined while we looked up the link
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
