# Matt vs Deep — Ping Pong (three.js)

```bash
npm install
npm run dev      # http://localhost:5173
```

**Controls:** mouse moves the paddle (it sits under the cursor) · click/Space to serve ·
swipe sideways through contact to aim · hold the button at contact for a power shot ·
`1 2 3` difficulty · `P` AI vs AI · `G` aim-assist ring · `M` mute · `C` narrator · `R` restart.

The start screen is a character select: pick **Matt**, **Deep** or **Steven** (remembered), then **Enter the office**.
Steven plays against Deep; online games are Matt vs Deep for now.
You start out walking around the office; the ping-pong table is one of the spots (walk up and press **F**).
Online, each player gets the character they picked if it's free (the relay falls back to the other one).

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

## Walking around the office

The game opens in the office. Press **F** during a match to walk away from the table. The match pauses (a point in progress is
replayed), and you can explore the office in third person:

- **WASD / arrows** walk (relative to the camera) · **Shift** jog · **drag** to look around · **wheel** to zoom
- Furniture and walls block you. Walk up to something and a prompt appears: **F** to interact.
- Back at your end of the ping-pong table, **F** resumes the match.
- The card table and the sofa are marked *soon*.

### The office floor

The game room's double doors stand open onto the rest of the floor, laid out from photos of the real
office. Each area's name pops up as you walk in:

- **Game room**: ping pong, chess and cards, foosball, the arcade basketball, the drinks fridge, and the grey booth nook by the door.
- **Desks**: three rows of standing desks under a tiled drop ceiling, with windows on the bay.
- **Lora Lounge** (north-west corner): the sectional, coffee tables, a TV on a rolling stand, and windows on two sides.
- **Meeting rooms**: two glass rooms you can see into.
- **Kitchen + dining** (east): the island and pendants, a steel fridge, the green booths, and the dining table. The windows face the brick building next door.

The floor's shell (walls, windows, ceilings, glass, cabinets) is built in `src/world/Floor.js`. The
furniture positions are in `office_layout.json`, written by `node scripts/layout-floor.mjs` (re-run it after changing the script).

### Chess

Walk to the café table with the chess set and press **F** to sit down. Offline, Deep gets up from the
ping-pong table, walks over and takes the other chair. **Click a piece, then a square** (legal moves show as
dots), **V** cycles the camera (seated / high angle / top down), the **wheel** zooms in and out,
**N** starts a new game, and **F** stands you up (Deep walks back to the table). Full rules: castling,
en passant, check/mate, stalemate, the fifty-move rule, repetition and insufficient material. Pawns
always promote to a queen. Deep's strength follows the match difficulty (search depth 1 / 2 / 3).

Online, Matt plays White and Deep plays Black, and moves sync once both players are seated. The game
survives standing up: whoever has the longer move list wins the sync when you both sit back down.

Online, each player can walk off on their own; the other player sees them wander around, and the match
stays paused until both are back at the table.

Code: `src/world/Explore.js` (movement, camera, collisions, spots), `src/chess/` (rules engine, AI, pieces, the table), `src/world/Props.js` (cards),
and the procedural walk cycle in `Character._updateWalk` (the rig has no walk clip).

## The narrator

Press **C** (or tick *Narrator* on the start screen) for a dry, faintly exasperated British storyteller
who narrates what you do in the third person, in the spirit of The Stanley Parable (the lines are our
own). He covers walking around the office, walking off mid-match, standing still too long, the start
and end of a match, supers, long rallies, match point, and chess (captures, check, castling,
promotion, the queen falling, mate and draws). His words appear near the top of the screen, fading in
in time with his voice, so it works with the sound off too (and screen readers announce each line).
The TV quiets down while he talks.

The script lives in `scripts/narrator-lines.json` (ElevenLabs v4 tags like `[dry]` set the delivery;
lines with `"per": true` say the local player's name). The voice is ElevenLabs v4 ("George") through
Comfy Router; after editing the script, regenerate the clips with:

```bash
node scripts/generate-narrator.mjs            # needs COMFY_API_KEY; only makes missing clips
node scripts/generate-narrator.mjs ch_queen   # redo specific lines
```

<details><summary>Easter eggs (spoilers)</summary>

He also comments the first time you walk into the desks, the lounge, the kitchen and the meeting rooms. He also notices if you: switch him off and on again a few times within a minute (and again if you
keep going), walk into a wall three times, stand watching the TV for 12 seconds, press F at the card
table or the sofa, lose five points in a row, or stand
up from a chess game you haven't finished. These lines are marked `"egg": true` in the script.

</details>

Clips land in `public/narrator/` (`<id>.mp3`, or `<id>_matt.mp3` / `<id>_deep.mp3` for `per` lines).
A line without a clip is shown as text only. Code: `src/audio/Narrator.js`.

## The office TV (purz.tv)

The wall TV plays the [purz.tv](https://purz.tv) channel: the same clips the site plays, shuffled,
back to back. Press **T** for TV sound (louder the closer you are) and **Y** for the next clip.
purz.tv can't be put in an iframe and its clips have no CORS headers, so the dev server proxies
`/purz/*` to `https://purz.tv` (see `vite.config.js`) and `src/world/TV.js` plays the clips as a video
texture laid over the front of `wall_tv.glb`. Each player's TV runs independently online.

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
  characters/roster.js      Matt, Deep & Steven definitions
  world/Floor.js            the rest of the office floor (shell, windows, zones)
  controllers/              HumanController (mouse), AIController (predict + error)
  entities/                 Arena, Ball, Paddle
  ui/HUD.js, audio/Sfx.js   scoreboard/messages, synthesized sounds
```

Hooks: `game.on('hit' | 'point' | 'pointStart' | 'gameOver', fn)` for camera shake, replays,
commentary, etc.
