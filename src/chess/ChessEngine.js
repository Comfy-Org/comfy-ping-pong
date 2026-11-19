/**
 * Chess rules. Squares are 0..63 = rank * 8 + file (a1 = 0, h1 = 7, a8 = 56).
 * Pieces are single chars: uppercase white (PNBRQK), lowercase black, '' empty.
 * Full rules: castling, en passant, promotion, check/checkmate/stalemate,
 * fifty-move rule, threefold repetition and insufficient material.
 */

const START = 'RNBQKBNR' + 'PPPPPPPP' + '.'.repeat(32) + 'pppppppp' + 'rnbqkbnr';

const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

export const colorOf = (p) => (!p ? null : p === p.toUpperCase() ? 'w' : 'b');
export const typeOf = (p) => p.toLowerCase();
export const sq = (file, rank) => rank * 8 + file;
export const fileOf = (s) => s & 7;
export const rankOf = (s) => s >> 3;
export const name = (s) => 'abcdefgh'[fileOf(s)] + (rankOf(s) + 1);
const onBoard = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;

export class Chess {
  constructor() {
    this.reset();
  }

  reset() {
    this.board = [...START].map((c) => (c === '.' ? '' : c));
    this.turn = 'w';
    this.castling = { K: true, Q: true, k: true, q: true };
    this.ep = -1; // en-passant target square
    this.halfmove = 0;
    this.history = []; // stack of { move, state } for undo
    this.positions = new Map([[this.key(), 1]]);
  }

  /** Load a FEN position (used by tests and for future puzzles). */
  load(fen) {
    const [placement, turn, castle, ep, half] = fen.split(' ');
    this.board = Array(64).fill('');
    placement.split('/').forEach((row, i) => {
      let f = 0;
      for (const c of row) {
        if (/\d/.test(c)) f += +c;
        else this.board[sq(f++, 7 - i)] = c;
      }
    });
    this.turn = turn;
    this.castling = { K: castle.includes('K'), Q: castle.includes('Q'), k: castle.includes('k'), q: castle.includes('q') };
    this.ep = ep === '-' ? -1 : sq('abcdefgh'.indexOf(ep[0]), +ep[1] - 1);
    this.halfmove = +(half ?? 0);
    this.history = [];
    this.positions = new Map([[this.key(), 1]]);
    return this;
  }

  /** Position key for repetition detection. */
  key() {
    const c = this.castling;
    return this.board.map((p) => p || '.').join('') + this.turn + (c.K ? 'K' : '') + (c.Q ? 'Q' : '') + (c.k ? 'k' : '') + (c.q ? 'q' : '') + this.ep;
  }

  kingSquare(color) {
    const k = color === 'w' ? 'K' : 'k';
    return this.board.indexOf(k);
  }

  /** Is `s` attacked by any piece of `by`? */
  attacked(s, by) {
    const b = this.board;
    const f = fileOf(s);
    const r = rankOf(s);
    const up = by === 'w' ? 'P' : 'p';
    const pr = by === 'w' ? r - 1 : r + 1; // the rank a pawn attacking s stands on
    for (const df of [-1, 1]) if (onBoard(f + df, pr) && b[sq(f + df, pr)] === up) return true;
    const n = by === 'w' ? 'N' : 'n';
    for (const [df, dr] of KNIGHT) if (onBoard(f + df, r + dr) && b[sq(f + df, r + dr)] === n) return true;
    const k = by === 'w' ? 'K' : 'k';
    for (const [df, dr] of KING) if (onBoard(f + df, r + dr) && b[sq(f + df, r + dr)] === k) return true;
    const slide = (dirs, kinds) => {
      for (const [df, dr] of dirs) {
        let ff = f + df;
        let rr = r + dr;
        while (onBoard(ff, rr)) {
          const p = b[sq(ff, rr)];
          if (p) {
            if (colorOf(p) === by && kinds.includes(typeOf(p))) return true;
            break;
          }
          ff += df;
          rr += dr;
        }
      }
      return false;
    };
    return slide(ROOK_DIRS, 'rq') || slide(BISHOP_DIRS, 'bq');
  }

  inCheck(color = this.turn) {
    return this.attacked(this.kingSquare(color), color === 'w' ? 'b' : 'w');
  }

  /** Pseudo-legal moves for the side to move (may leave own king in check). */
  pseudoMoves() {
    const out = [];
    const b = this.board;
    const me = this.turn;
    const them = me === 'w' ? 'b' : 'w';
    const add = (from, to, extra = {}) => out.push({ from, to, piece: b[from], captured: b[to] || '', ...extra });

    for (let s = 0; s < 64; s++) {
      const p = b[s];
      if (!p || colorOf(p) !== me) continue;
      const f = fileOf(s);
      const r = rankOf(s);
      const t = typeOf(p);
      if (t === 'p') {
        const dir = me === 'w' ? 1 : -1;
        const startRank = me === 'w' ? 1 : 6;
        const lastRank = me === 'w' ? 7 : 0;
        const pushPromo = (to, extra) => {
          if (rankOf(to) === lastRank) for (const promo of 'qrbn') add(s, to, { ...extra, promo });
          else add(s, to, extra);
        };
        const one = sq(f, r + dir);
        if (onBoard(f, r + dir) && !b[one]) {
          pushPromo(one);
          const two = sq(f, r + 2 * dir);
          if (r === startRank && !b[two]) add(s, two, { double: true });
        }
        for (const df of [-1, 1]) {
          if (!onBoard(f + df, r + dir)) continue;
          const to = sq(f + df, r + dir);
          if (b[to] && colorOf(b[to]) === them) pushPromo(to);
          else if (to === this.ep) add(s, to, { enPassant: true, captured: me === 'w' ? 'p' : 'P' });
        }
      } else if (t === 'n' || t === 'k') {
        for (const [df, dr] of t === 'n' ? KNIGHT : KING) {
          if (!onBoard(f + df, r + dr)) continue;
          const to = sq(f + df, r + dr);
          if (!b[to] || colorOf(b[to]) === them) add(s, to);
        }
        if (t === 'k') this._castles(s, out);
      } else {
        const dirs = t === 'r' ? ROOK_DIRS : t === 'b' ? BISHOP_DIRS : [...ROOK_DIRS, ...BISHOP_DIRS];
        for (const [df, dr] of dirs) {
          let ff = f + df;
          let rr = r + dr;
          while (onBoard(ff, rr)) {
            const to = sq(ff, rr);
            if (b[to]) {
              if (colorOf(b[to]) === them) add(s, to);
              break;
            }
            add(s, to);
            ff += df;
            rr += dr;
          }
        }
      }
    }
    return out;
  }

  _castles(kingSq, out) {
    const me = this.turn;
    const them = me === 'w' ? 'b' : 'w';
    const home = me === 'w' ? 4 : 60;
    if (kingSq !== home || this.inCheck(me)) return;
    const b = this.board;
    const [kSide, qSide] = me === 'w' ? ['K', 'Q'] : ['k', 'q'];
    const rook = me === 'w' ? 'R' : 'r';
    if (this.castling[kSide] && !b[home + 1] && !b[home + 2] && b[home + 3] === rook && !this.attacked(home + 1, them) && !this.attacked(home + 2, them)) {
      out.push({ from: home, to: home + 2, piece: b[home], captured: '', castle: 'k' });
    }
    if (this.castling[qSide] && !b[home - 1] && !b[home - 2] && !b[home - 3] && b[home - 4] === rook && !this.attacked(home - 1, them) && !this.attacked(home - 2, them)) {
      out.push({ from: home, to: home - 2, piece: b[home], captured: '', castle: 'q' });
    }
  }

  /** Legal moves for the side to move (optionally only those from one square). */
  moves(from = -1) {
    const me = this.turn;
    const legal = [];
    for (const m of this.pseudoMoves()) {
      if (from >= 0 && m.from !== from) continue;
      this._apply(m);
      if (!this.inCheck(me)) legal.push(m);
      this._unapply();
    }
    return legal;
  }

  /** Play a legal move given as {from, to, promo?}; returns the full move or null if illegal. */
  move({ from, to, promo = 'q' }) {
    const m = this.moves(from).find((x) => x.to === to && (!x.promo || x.promo === promo));
    if (!m) return null;
    this._apply(m);
    const k = this.key();
    this.positions.set(k, (this.positions.get(k) ?? 0) + 1);
    m.san = this._san(m);
    return m;
  }

  undo() {
    if (!this.history.length) return null;
    const k = this.key();
    const n = this.positions.get(k);
    if (n > 1) this.positions.set(k, n - 1);
    else this.positions.delete(k);
    return this._unapply();
  }

  /** Make a move without legality checks or repetition bookkeeping (search uses this). */
  _apply(m) {
    const b = this.board;
    this.history.push({ move: m, state: { castling: { ...this.castling }, ep: this.ep, halfmove: this.halfmove } });
    const me = this.turn;
    b[m.to] = m.promo ? (me === 'w' ? m.promo.toUpperCase() : m.promo) : m.piece;
    b[m.from] = '';
    if (m.enPassant) b[m.to + (me === 'w' ? -8 : 8)] = '';
    if (m.castle) {
      const [rf, rt] = m.castle === 'k' ? [m.from + 3, m.from + 1] : [m.from - 4, m.from - 1];
      b[rt] = b[rf];
      b[rf] = '';
    }
    // Castling rights: king or rook moved, or a rook was captured on its home square.
    const c = this.castling;
    if (m.piece === 'K') c.K = c.Q = false;
    if (m.piece === 'k') c.k = c.q = false;
    for (const s of [m.from, m.to]) {
      if (s === 0) c.Q = false;
      if (s === 7) c.K = false;
      if (s === 56) c.q = false;
      if (s === 63) c.k = false;
    }
    this.ep = m.double ? (m.from + m.to) / 2 : -1;
    this.halfmove = typeOf(m.piece) === 'p' || m.captured ? 0 : this.halfmove + 1;
    this.turn = me === 'w' ? 'b' : 'w';
  }

  _unapply() {
    const h = this.history.pop();
    if (!h) return null;
    const { move: m, state } = h;
    const b = this.board;
    this.turn = this.turn === 'w' ? 'b' : 'w';
    const me = this.turn;
    b[m.from] = m.piece;
    b[m.to] = m.enPassant ? '' : m.captured;
    if (m.enPassant) b[m.to + (me === 'w' ? -8 : 8)] = m.captured;
    if (m.castle) {
      const [rf, rt] = m.castle === 'k' ? [m.from + 3, m.from + 1] : [m.from - 4, m.from - 1];
      b[rf] = b[rt];
      b[rt] = '';
    }
    this.castling = state.castling;
    this.ep = state.ep;
    this.halfmove = state.halfmove;
    return m;
  }

  insufficientMaterial() {
    const rest = this.board.filter((p) => p && typeOf(p) !== 'k');
    if (rest.length === 0) return true;
    if (rest.length === 1 && 'bn'.includes(typeOf(rest[0]))) return true;
    return false;
  }

  /**
   * 'play' | 'checkmate' | 'stalemate' | 'fifty' | 'repetition' | 'material'.
   * For checkmate the loser is `this.turn`.
   */
  status() {
    if (this.moves().length === 0) return this.inCheck() ? 'checkmate' : 'stalemate';
    if (this.halfmove >= 100) return 'fifty';
    if ((this.positions.get(this.key()) ?? 0) >= 3) return 'repetition';
    if (this.insufficientMaterial()) return 'material';
    return 'play';
  }

  /** Standard algebraic notation for a move that was just applied. */
  _san(m) {
    let s;
    if (m.castle) s = m.castle === 'k' ? 'O-O' : 'O-O-O';
    else {
      const t = typeOf(m.piece);
      const cap = m.captured ? 'x' : '';
      if (t === 'p') s = (cap ? 'abcdefgh'[fileOf(m.from)] : '') + cap + name(m.to) + (m.promo ? '=' + m.promo.toUpperCase() : '');
      else {
        // Disambiguate against other same-type pieces that could reach the same square.
        this._unapply();
        const others = this.moves().filter((x) => x.piece === m.piece && x.to === m.to && x.from !== m.from);
        this._apply(m);
        let dis = '';
        if (others.length) {
          const sameFile = others.some((x) => fileOf(x.from) === fileOf(m.from));
          const sameRank = others.some((x) => rankOf(x.from) === rankOf(m.from));
          dis = !sameFile ? 'abcdefgh'[fileOf(m.from)] : !sameRank ? String(rankOf(m.from) + 1) : name(m.from);
        }
        s = t.toUpperCase() + dis + cap + name(m.to);
      }
    }
    if (this.inCheck()) s += this.moves().length ? '+' : '#';
    return s;
  }
}
