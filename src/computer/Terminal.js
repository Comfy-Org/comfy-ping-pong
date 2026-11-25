/**
 * The work program on the office computers: "Numeric Tending", by Pellucid Systems.
 * A game inside the game, in the spirit of a mysterious office job where nobody
 * explains what the numbers mean (an original take, not any show's actual program).
 *
 * A field of drifting digits. Some small clusters feel *off*, and each kind moves in
 * its own way:
 *   HUSH  — breathes slowly, dimming and brightening
 *   SPARK — flickers
 *   KNOT  — trembles in place
 *   DRIFT — sways side to side
 * Drag a box around a cluster, then send it to the matching bin (click it, or 1–4).
 * Fill all four bins to finish the file. Esc or F leaves the desk.
 */

const COLS = 18;
const ROWS = 10;
const BINS = [
  { id: 'hush', name: 'HUSH', color: '#8fd3c7' },
  { id: 'spark', name: 'SPARK', color: '#f2d27a' },
  { id: 'knot', name: 'KNOT', color: '#e89a8b' },
  { id: 'drift', name: 'DRIFT', color: '#a9b8f0' },
];
const PER_BIN = 4; // clusters per bin to complete a file
const LIVE_GROUPS = 5; // clusters hidden in the field at once
const FILE_WORDS = [
  ['Tallow', 'Marrow', 'Glass', 'Ember', 'Quiet', 'Lantern', 'Oxbow', 'Fennel', 'Cobalt', 'Wicker', 'Harrow', 'Plume'],
  ['Creek', 'Hollow', 'Spire', 'Meadow', 'Basin', 'Ridge', 'Cove', 'Thicket', 'Landing', 'Reach', 'Fold', 'Mere'],
];
const PRAISE = [
  'Your diligence has been noted.',
  'The numbers are grateful, in their way.',
  'A tidy file. Someone, somewhere, is pleased.',
  'Exemplary. Please do not ask what for.',
];

export class Terminal {
  constructor(game, onLeave) {
    this.game = game;
    this.onLeave = onLeave;
    this.open = false;
    this.el = document.createElement('div');
    this.el.className = 'terminal';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="crt">
        <header><span class="brand">PELLUCID <i>Numeric Tending</i></span><span class="file"></span><span class="pct"></span></header>
        <canvas></canvas>
        <footer class="bins">${BINS.map(
          (b, i) => `<button data-bin="${i}" style="--c:${b.color}"><b>${b.name}</b><span class="bar"><span></span></span><small>${i + 1}</small></button>`
        ).join('')}</footer>
        <div class="note"></div>
        <p class="help">Drag to select digits that feel off · send them to a bin (click or 1–4) · <kbd>Esc</kbd> leave desk · <kbd>H</kbd> hide hints</p>
      </div>`;
    document.body.appendChild(this.el);
    this.canvas = this.el.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.noteEl = this.el.querySelector('.note');
    this._bind();
    this._newFile();
  }

  // ------------------------------------------------------------------ file

  _newFile() {
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    this.fileName = `${pick(FILE_WORDS[0])} ${pick(FILE_WORDS[1])}`;
    this.fill = BINS.map(() => 0);
    this.cells = [];
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) this.cells.push({ c, r, d: rnd(10), group: null, phase: Math.random() * 6.28, out: 0 });
    this.groups = [];
    while (this.groups.length < LIVE_GROUPS) this._spawnGroup();
    this.selection = null;
    this.done = false;
    this.el.querySelector('.file').textContent = this.fileName;
    this._updateBins();
  }

  /** A small connected blob of 3–6 cells with one category, on cells not already in a group. */
  _spawnGroup() {
    // Prefer categories whose bins still need clusters.
    const need = BINS.map((_, i) => i).filter((i) => this.fill[i] < PER_BIN);
    const kind = need.length ? need[rnd(need.length)] : rnd(BINS.length);
    for (let tries = 0; tries < 40; tries++) {
      const start = this.cells[rnd(this.cells.length)];
      if (start.group || start.out) continue;
      const size = 3 + rnd(4);
      const blob = [start];
      while (blob.length < size) {
        const from = blob[rnd(blob.length)];
        const [dc, dr] = [[1, 0], [-1, 0], [0, 1], [0, -1]][rnd(4)];
        const next = this._cell(from.c + dc, from.r + dr);
        if (next && !next.group && !next.out && !blob.includes(next)) blob.push(next);
        if (blob.length < size && tries++ > 200) break;
      }
      if (blob.length < 3) continue;
      // Keep groups apart so a box can catch one cleanly.
      if (blob.some((b) => this._neighbours(b).some((n) => n.group))) continue;
      const g = { kind, cells: blob };
      blob.forEach((b) => (b.group = g));
      this.groups.push(g);
      return;
    }
  }

  _cell(c, r) {
    return c >= 0 && c < COLS && r >= 0 && r < ROWS ? this.cells[r * COLS + c] : null;
  }
  _neighbours(b) {
    return [this._cell(b.c + 1, b.r), this._cell(b.c - 1, b.r), this._cell(b.c, b.r + 1), this._cell(b.c, b.r - 1)].filter(Boolean);
  }

  // -------------------------------------------------------------- actions

  /** Send the selected cells to bin i. */
  _sort(i) {
    if (this.done) return;
    const sel = this.cells.filter((x) => x.sel);
    if (!sel.length) return this._note('Select some digits first.');
    // The group the selection mostly covers.
    const counts = new Map();
    sel.forEach((x) => x.group && counts.set(x.group, (counts.get(x.group) ?? 0) + 1));
    const [g, hit] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
    const clear = () => this.cells.forEach((x) => (x.sel = false));
    if (!g || hit < Math.ceil(g.cells.length * 0.6) || sel.length > g.cells.length * 2 + 2) {
      clear();
      return this._note('Nothing out of the ordinary there.');
    }
    if (g.kind !== i) {
      clear();
      this._shake = 0.35;
      return this._note(`Those were not ${BINS[i].name}. Feel them again.`);
    }
    // Refined: the digits float down into the bin and fresh ones take their place.
    clear();
    this.groups.splice(this.groups.indexOf(g), 1);
    for (const x of g.cells) {
      x.group = null;
      x.out = 1;
      x.toBin = i;
    }
    this.fill[i] = Math.min(PER_BIN, this.fill[i] + 1);
    this._updateBins();
    this.game.sfx?.play?.('hit');
    if (this.fill.every((f) => f >= PER_BIN)) {
      this.done = true;
      this._note(`${this.fileName} is complete. ${PRAISE[rnd(PRAISE.length)]}`, 4);
      this.game.emit('fileComplete', { name: this.fileName });
      setTimeout(() => this.open && this._newFile(), 4500);
      return;
    }
    setTimeout(() => this._spawnGroup(), 700);
  }

  _note(text, secs = 2) {
    this.noteEl.textContent = text;
    this.noteEl.classList.add('on');
    clearTimeout(this._noteT);
    this._noteT = setTimeout(() => this.noteEl.classList.remove('on'), secs * 1000);
  }

  _updateBins() {
    this.el.querySelectorAll('.bins button').forEach((b, i) => {
      b.querySelector('.bar span').style.width = `${(this.fill[i] / PER_BIN) * 100}%`;
    });
    const pct = Math.round((this.fill.reduce((a, b) => a + b, 0) / (PER_BIN * BINS.length)) * 100);
    this.el.querySelector('.pct').textContent = `${pct}% complete`;
  }

  // ------------------------------------------------------------- open/close

  show() {
    if (this.open) return;
    this.open = true;
    this.el.hidden = false;
    requestAnimationFrame(() => this.el.classList.add('on'));
    this._last = performance.now();
    const loop = (t) => {
      if (!this.open) return;
      this._draw(Math.min(0.05, (t - this._last) / 1000), t / 1000);
      this._last = t;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    this.game.emit('computerOn');
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.el.classList.remove('on');
    this.el.hidden = true;
    this.selection = null;
    this.cells.forEach((x) => (x.sel = false));
  }

  // ----------------------------------------------------------------- input

  _bind() {
    const toCell = (e) => {
      const r = this.canvas.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * this.canvas.width, y: ((e.clientY - r.top) / r.height) * this.canvas.height };
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      if (this.done) return;
      const p = toCell(e);
      this.selection = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      const p = toCell(e);
      this.mouse = p;
      if (!this.selection) return;
      this.selection.x1 = p.x;
      this.selection.y1 = p.y;
      this._applySelection();
    });
    this.canvas.addEventListener('pointerup', () => {
      if (this.selection) this._applySelection();
      this.selection = null;
    });
    this.canvas.addEventListener('pointerleave', () => (this.mouse = null));
    this.el.querySelectorAll('.bins button').forEach((b) => (b.onclick = () => this._sort(Number(b.dataset.bin))));
    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.open) return;
        if (e.code === 'Escape' || e.code === 'KeyF') {
          e.stopImmediatePropagation();
          this.onLeave();
        } else if (/^Digit[1-4]$/.test(e.code)) this._sort(Number(e.code.slice(5)) - 1);
        // Keep the office's own keys (walking, narrator, TV…) out of the program.
        if (!['KeyC', 'KeyT', 'KeyY', 'KeyM', 'KeyH'].includes(e.code)) e.stopImmediatePropagation();
      },
      true
    );
  }

  _applySelection() {
    const s = this.selection;
    const [x0, x1] = [Math.min(s.x0, s.x1), Math.max(s.x0, s.x1)];
    const [y0, y1] = [Math.min(s.y0, s.y1), Math.max(s.y0, s.y1)];
    for (const x of this.cells) {
      const { cx, cy } = this._pos(x);
      x.sel = !x.out && cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1;
    }
  }

  // ------------------------------------------------------------------ draw

  _layout() {
    const c = this.canvas;
    const w = Math.round(c.clientWidth * devicePixelRatio);
    const h = Math.round(c.clientHeight * devicePixelRatio);
    if (c.width !== w || c.height !== h) [c.width, c.height] = [w, h];
    this.cw = c.width / (COLS + 1);
    this.ch = c.height / (ROWS + 1);
  }

  _pos(x) {
    return { cx: (x.c + 1) * this.cw, cy: (x.r + 1) * this.ch };
  }

  _draw(dt, t) {
    this._layout();
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const size = Math.min(this.cw, this.ch) * 0.52;
    ctx.font = `500 ${size}px "IBM Plex Mono", ui-monospace, Menlo, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    this._shake = Math.max(0, (this._shake ?? 0) - dt);
    const shake = this._shake ? Math.sin(t * 90) * 6 * this._shake : 0;
    const binsTop = canvas.height;

    for (const x of this.cells) {
      let { cx, cy } = this._pos(x);
      cx += shake;
      // Every digit idles a little; the off ones move in their own way.
      cy += Math.sin(t * 0.8 + x.phase) * size * 0.04;
      let alpha = 0.78;
      let scale = 1;
      const g = x.group;
      if (g) {
        const k = g.kind;
        if (k === 0) alpha = 0.45 + 0.5 * (0.5 + 0.5 * Math.sin(t * 1.6 + x.c * 0.3));
        if (k === 1) alpha = Math.sin(t * 23 + x.phase * 5) > 0.55 ? 0.35 : 0.95;
        if (k === 2) {
          cx += Math.sin(t * 41 + x.phase * 7) * size * 0.06;
          cy += Math.cos(t * 37 + x.phase * 3) * size * 0.06;
        }
        if (k === 3) cx += Math.sin(t * 1.9 + x.r * 0.6) * size * 0.22;
      }
      // Hover: the digits under the cursor lean in.
      if (this.mouse) {
        const d = Math.hypot(cx - this.mouse.x, cy - this.mouse.y) / (this.cw * 2.2);
        if (d < 1) scale += 0.35 * (1 - d) ** 2;
      }
      if (x.out) {
        // Refined digits sink toward their bin and fade, then a new digit appears.
        x.out += dt * 1.4;
        const p = Math.min(1, x.out - 1);
        const bx = ((x.toBin + 0.5) / BINS.length) * canvas.width;
        cx += (bx - cx) * p * p;
        cy += (binsTop - cy) * p * p;
        alpha *= 1 - p;
        if (p >= 1) {
          x.out = 0;
          x.d = rnd(10);
          x.phase = Math.random() * 6.28;
        }
      }
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = x.sel ? '#ffffff' : '#9fe6d6';
      ctx.shadowColor = x.sel ? '#ffffff' : '#46b6a0';
      ctx.shadowBlur = x.sel ? 14 : 8;
      ctx.fillText(String(x.d), 0, 0);
      ctx.restore();
    }

    if (this.selection) {
      const s = this.selection;
      ctx.strokeStyle = 'rgba(159,230,214,0.8)';
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(s.x0, s.y0, s.x1 - s.x0, s.y1 - s.y0);
      ctx.setLineDash([]);
    }
  }
}

function rnd(n) {
  return Math.floor(Math.random() * n);
}
