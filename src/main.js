import { Game } from './game/Game.js';
import { Lobby } from './ui/Lobby.js';
import { TV } from './world/TV.js';
import { Narrator } from './audio/Narrator.js';
import { lineupFor } from './characters/roster.js';
import { loadPick } from './ui/Lobby.js';

const app = document.getElementById('app');
const lineup = lineupFor(loadPick());
const game = new Game(app, { characters: lineup.characters });
game.lineup = lineup.characters.map((c) => c.id).join(',');
game.start();
game.setDemo(true); // AI vs AI plays behind the menu
const tv = new TV(game); // purz.tv on the office wall
game.tv = tv;
game.narrator = new Narrator(game); // C toggles the dramatic narrator

const lobby = new Lobby(document.body, game);
const room = new URLSearchParams(location.search).get('room');
if (room) lobby.connect(room.toUpperCase());
else if (consumeAutoEnter()) lobby.playAI(); // picked someone not at the table yet: we reloaded with them
else lobby.showMenu();

function consumeAutoEnter() {
  try {
    const v = sessionStorage.getItem('autoEnter');
    sessionStorage.removeItem('autoEnter');
    return v === '1';
  } catch {
    return false;
  }
}

// Handy for debugging from the console.
// TODO(dev): debug dev view + `window.__dev` test/benchmark hooks. See TODO.md (Dev tooling).
window.game = game;
window.lobby = lobby;
window.tv = tv;
