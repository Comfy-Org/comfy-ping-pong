/** DOM overlay: scoreboard, center messages, help line. */
export class HUD {
  constructor(root, names) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.innerHTML = `
      <div class="board">
        <div class="pl p0"><span class="srv"></span><span class="nm">${names[0]}</span><span class="sc">0</span><i class="mtr"><b></b></i></div>
        <div class="pl p1"><span class="sc">0</span><span class="nm">${names[1]}</span><span class="srv"></span><i class="mtr"><b></b></i></div>
      </div>
      <div class="superhint"></div>
      <div class="flash"></div>
      <div class="msg"><div class="big"></div><div class="sub"></div></div>
      <div class="help">
        <span>Mouse: paddle</span><span>Click / Space: serve</span><span>Swipe sideways: aim</span>
        <span>Hold button at contact: power</span><span>Swipe up / down through the ball: topspin / backspin</span>
        <span>E / Shift / right-click: super smash (meter full)</span><span>1 2 3: difficulty</span><span>P: AI vs AI</span>
        <span>G: aim assist</span><span>M: mute</span><span>C: narrator</span><span>T: TV sound</span><span>R: restart</span><span><b>F: walk away from the table</b></span><span>H: hide hints</span>
      </div>
      <div class="help explore-help">
        <span>WASD / arrows: walk</span><span>Shift: jog</span><span>Drag: look around</span><span>Wheel: zoom</span>
        <span>F: interact</span><span>T: TV sound</span><span>Y: next clip</span><span>C: narrator</span><span>H: hide hints</span>
      </div>
      <div class="hints-tip">H: show controls</div>
      <div class="prompt"></div>
      <div class="status"></div>`;
    root.appendChild(this.el);
    this.$ = (s) => this.el.querySelector(s);
    this._msgTimer = 0;
    // H hides the control hints everywhere (remembered between visits).
    const setHints = (on) => {
      document.body.classList.toggle('hints-off', !on);
      try {
        localStorage.setItem('hints', on ? '1' : '0');
      } catch {}
    };
    let stored = null;
    try {
      stored = localStorage.getItem('hints');
    } catch {}
    setHints(stored !== '0');
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.code !== 'KeyH' || e.repeat) return;
      setHints(document.body.classList.contains('hints-off'));
    });
  }

  setScore(score, server) {
    for (const i of [0, 1]) {
      this.$(`.p${i} .sc`).textContent = score[i];
      this.$(`.p${i} .srv`).classList.toggle('on', server === i);
    }
  }

  message(big, sub = '', seconds = 0) {
    this.$('.msg .big').textContent = big;
    this.$('.msg .sub').textContent = sub;
    this.$('.msg').classList.toggle('show', !!(big || sub));
    this._msgTimer = seconds;
  }

  /** meters 0..1; `local` = side whose ready/armed hint to show (-1 for none). */
  setMeters(meters, armed, local) {
    for (const i of [0, 1]) {
      const pl = this.$(`.p${i}`);
      pl.querySelector('.mtr b').style.width = `${Math.round(meters[i] * 100)}%`;
      pl.classList.toggle('full', meters[i] >= 1 && !armed[i]);
      pl.classList.toggle('armed', armed[i]);
    }
    const hint = this.$('.superhint');
    if (local < 0) hint.textContent = '';
    else if (armed[local]) hint.textContent = 'SUPER ARMED — your next hit is a smash';
    else if (meters[local] >= 1) hint.textContent = 'SUPER READY — press E or right-click';
    else hint.textContent = '';
    hint.classList.toggle('on', !!hint.textContent);
  }

  /** Short callout under the scoreboard: kind = top | back | side | super. */
  flash(text, kind = '') {
    const el = this.$('.flash');
    el.textContent = text;
    el.className = `flash show ${kind}`;
    this._flashTimer = kind === 'super' ? 1.4 : 0.8;
  }

  /** Interaction prompt at the bottom (HTML allowed: <kbd>, <em>). Empty hides it. */
  setPrompt(html) {
    const el = this.$('.prompt');
    if (el._html === html) return;
    el._html = html;
    el.innerHTML = html;
    el.classList.toggle('show', !!html);
  }

  /** 'match' or 'explore': swaps the help line. */
  setMode(mode) {
    this.el.classList.toggle('exploring', mode === 'explore');
  }

  setStatus(text) {
    this.$('.status').textContent = text;
  }

  update(dt) {
    if (this._flashTimer > 0) {
      this._flashTimer -= dt;
      if (this._flashTimer <= 0) this.$('.flash').classList.remove('show');
    }
    if (this._msgTimer > 0) {
      this._msgTimer -= dt;
      if (this._msgTimer <= 0) this.message('');
    }
  }
}
