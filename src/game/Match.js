import { RULES } from '../config.js';

/** Scoring + serve rotation for a single game to 11 (win by 2). */
export class Match {
  constructor(firstServer = 0) {
    this.firstServer = firstServer;
    this.reset();
  }

  reset() {
    this.score = [0, 0];
    this.winner = null;
  }

  get server() {
    const [a, b] = this.score;
    const total = a + b;
    const deuce = RULES.pointsToWin - 1;
    const n = RULES.servesPerTurn;
    const turns =
      a >= deuce && b >= deuce
        ? Math.floor((deuce * 2) / n) + (total - deuce * 2) // alternate every point at deuce
        : Math.floor(total / n);
    return (this.firstServer + turns) % 2;
  }

  award(side) {
    if (this.winner !== null) return;
    this.score[side]++;
    const s = this.score[side];
    const o = this.score[1 - side];
    if (s >= RULES.pointsToWin && s - o >= RULES.winBy) this.winner = side;
  }
}
