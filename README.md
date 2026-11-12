# Matt vs Deep — Ping Pong (three.js)

```bash
npm install
npm run dev      # http://localhost:5173
```

**Controls:** mouse moves the paddle (it sits under the cursor) · click/Space to serve ·
swipe sideways through contact to aim · hold the button at contact for a power shot ·
`1 2 3` difficulty · `P` AI vs AI · `G` aim-assist ring · `M` mute · `R` restart.

## Spin and super smash

- **Spin** comes from how the paddle moves through the ball: brush **up** = topspin (dips, kicks
  forward off the table), chop **down** = backspin (floats, checks up), **sideways** = sidespin (curves).
  The trail is colored by spin (red top, blue back, purple side). Spin you don't handle throws your
  return off (topspin sends it long, backspin into the net); swinging firmly through contact controls it.
- **Super meter** (bar under each name) fills with every return, faster in long rallies, and
  faster when you lose points. When it's full, press **E**, **Shift** or **right-click** to arm it:
  your next return is a smash (huge pace and topspin, hit-stop, camera shake) that's much harder to get a paddle on.
  The AI uses its meter too.
- Tuning lives in `src/config.js` (`SPIN`, `SUPER`, and `spinUse` / `spinControl` / `superUse` per difficulty).
  Shot solvers in `src/physics/trajectory.js` fly the real integrator (Magnus + bounce friction) and
  correct the aim, so AI and human shots land where they're aimed even with spin.

## Online multiplayer

The start menu can **host** a room (you get a 4-letter code + share link) or **join** one.
The first player in a room is Matt, the second is Deep. A tiny WebSocket relay runs inside
the Vite server (`server/relay.js`); all game logic stays in the browsers:

- Ball flight is deterministic, so a hit only sends the ball's position and velocity.
- Each flight is judged by the player it's flying **toward**, so your own hits and misses are
  instant, and the result is sent to the other side. Paddles stream at 30 Hz and are interpolated.

**Playing a friend over Tailscale** (tailnet-only, and Vite stays on localhost):

```bash
npm run dev            # terminal 1
npm run tailnet        # proxies https://<this-mac>.<tailnet>.ts.net:8443 -> localhost:5173
```

Open the game at that `ts.net:8443` address yourself, host a match, and send your friend the
link. They must be on your tailnet (invite them, or share this machine with them from the
Tailscale admin console). `npm run tailnet:off` removes the proxy.

## Characters

Matt and Deep are rigged Meshy humanoids in `public/models/` (`matt.glb`, `deep.glb`, copied
from the asset session's `*_emotes.glb`). They're configured in `src/characters/roster.js`:
model path, auto-scale height, and which emote clips to play.

- **In play:** the rig has no idle/swing clips, so posing is procedural. CCD IK puts the right hand
  on the paddle grip (the spine joins at low weight so they lean for low balls), the body steps
  toward the paddle when the arm can't reach, and the left arm hangs by the hip.
- **Emotes:** a random `point_fist_pump` / `point_flex` on each point won, and a looping
  `win_floss` (Matt) / `win_victory_jump` (Deep) on winning the game. During an emote the
  paddle rides in the right hand (visual only).
- Set `model: null` to fall back to the capsule placeholder.

The **paddle is the gameplay object**, positioned by the controller; the body only follows it.

## Layout

```
src/
  config.js                 all tunables: table dims, physics, reach, AI difficulty
  physics/ballPhysics.js    stepBall() (gravity, table/net/floor), predictInterception()
  physics/trajectory.js     solveShot() / solveServe(): velocity to land on a target
  game/Game.js              loop (fixed 240 Hz step), phases, rules, hits, event bus
  game/Match.js             scoring to 11 win-by-2, serve rotation (every 2, every 1 at deuce)
  characters/Character.js   avatar: placeholder or GLB, swing/celebrate hooks
  characters/roster.js      Matt & Deep definitions
  controllers/              HumanController (mouse), AIController (predict + error)
  entities/                 Arena, Ball, Paddle
  ui/HUD.js, audio/Sfx.js   scoreboard/messages, synthesized sounds
```

Hooks: `game.on('hit' | 'point' | 'pointStart' | 'gameOver', fn)` for camera shake, replays,
commentary, etc.
