import { Game } from './game/Game.js';
import { Lobby } from './ui/Lobby.js';

const app = document.getElementById('app');
const game = new Game(app);
game.start();
game.setDemo(true); // AI vs AI plays behind the menu

const lobby = new Lobby(document.body, game);
const room = new URLSearchParams(location.search).get('room');
if (room) lobby.connect(room.toUpperCase());
else lobby.showMenu();

// Handy for debugging from the console.
window.game = game;
window.lobby = lobby;
