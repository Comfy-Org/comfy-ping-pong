import { colorOf, typeOf } from './ChessEngine.js';

/**
 * Deep's chess brain: negamax + alpha-beta + capture quiescence, material and
 * piece-square evaluation. Difficulty scales depth and how often he blunders.
 */

export const CHESS_LEVELS = {
  easy: { depth: 1, noise: 120, blunder: 0.2 },
  medium: { depth: 2, noise: 30, blunder: 0.05 },
  hard: { depth: 3, noise: 6, blunder: 0 },
};

const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// Piece-square tables from white's point of view, a8..h1 reading order (row 0 = rank 8).
const PST = {
  p: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  n: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  b: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  r: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  k: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
};

/** Index into the tables: white reads them flipped vertically (a1 = row 7). */
const pstIndex = (s, color) => (color === 'w' ? (7 - (s >> 3)) * 8 + (s & 7) : s);

/** Static evaluation from the side-to-move's perspective. */
export function evaluate(chess) {
  let score = 0;
  const b = chess.board;
  for (let s = 0; s < 64; s++) {
    const p = b[s];
    if (!p) continue;
    const c = colorOf(p);
    const t = typeOf(p);
    const v = VALUE[t] + PST[t][pstIndex(s, c)];
    score += c === 'w' ? v : -v;
  }
  return chess.turn === 'w' ? score : -score;
}

const MATE = 100000;

function order(moves) {
  // Captures first (most valuable victim, least valuable attacker), then promotions.
  return moves.sort((a, b) => score(b) - score(a));
  function score(m) {
    return (m.captured ? 10 * VALUE[typeOf(m.captured)] - VALUE[typeOf(m.piece)] + 1000 : 0) + (m.promo ? 800 : 0);
  }
}

function quiesce(chess, alpha, beta, depth, stats) {
  stats.nodes++;
  const stand = evaluate(chess);
  if (stand >= beta || depth === 0) return stand;
  if (stand > alpha) alpha = stand;
  const me = chess.turn;
  for (const m of order(chess.pseudoMoves().filter((x) => x.captured))) {
    chess._apply(m);
    if (chess.inCheck(me)) {
      chess._unapply();
      continue;
    }
    const s = -quiesce(chess, -beta, -alpha, depth - 1, stats);
    chess._unapply();
    if (s >= beta) return s;
    if (s > alpha) alpha = s;
  }
  return alpha;
}

function negamax(chess, depth, alpha, beta, ply, stats) {
  if (depth === 0) return quiesce(chess, alpha, beta, 4, stats);
  stats.nodes++;
  const me = chess.turn;
  let any = false;
  let best = -Infinity;
  for (const m of order(chess.pseudoMoves())) {
    chess._apply(m);
    if (chess.inCheck(me)) {
      chess._unapply();
      continue;
    }
    any = true;
    const s = -negamax(chess, depth - 1, -beta, -alpha, ply + 1, stats);
    chess._unapply();
    if (s > best) best = s;
    if (s > alpha) alpha = s;
    if (alpha >= beta) break;
  }
  if (!any) return chess.inCheck(me) ? -MATE + ply : 0; // mated (prefer later) or stalemate
  return best;
}

/** Pick a move for the side to move. Returns {from, to, promo} or null if none. */
export function chooseMove(chess, level = 'medium') {
  const cfg = CHESS_LEVELS[level] ?? CHESS_LEVELS.medium;
  const moves = order(chess.moves());
  if (!moves.length) return null;
  if (Math.random() < cfg.blunder) {
    const m = moves[Math.floor(Math.random() * moves.length)];
    return { from: m.from, to: m.to, promo: m.promo };
  }
  const stats = { nodes: 0 };
  let best = null;
  let bestScore = -Infinity;
  for (const m of moves) {
    chess._apply(m);
    const s = -negamax(chess, cfg.depth - 1, -Infinity, Infinity, 1, stats) + (Math.random() - 0.5) * 2 * cfg.noise;
    chess._unapply();
    if (s > bestScore) {
      bestScore = s;
      best = m;
    }
  }
  return { from: best.from, to: best.to, promo: best.promo, nodes: stats.nodes };
}
