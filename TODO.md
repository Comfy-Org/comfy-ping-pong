# TODO

Running list of what's next. Newest asks at the top of each section; tick them off as they land.

## Dev tooling

- [ ] **Debug dev view in the viewport** (toggle with a key, e.g. backtick, and `?debug` in the URL):
  - FPS / frame time graph, draw calls, triangles, textures, geometries (`renderer.info`), JS heap.
  - Overlays: walkable rects, colliders, camera rects/blocks, zones, seat stand spots and their
    radius, interaction spots, door swing arcs, audio sources (with distance rings).
  - Readouts: player position / yaw / zone / floor surface, current spot, network RTT and seat
    state, active game mode.
  - Free-fly camera that doesn't move the player.
- [ ] **Test and benchmark hooks** (one documented `window.__dev` API, available in dev builds):
  - Deterministic stepping: `step(frames, dt)` that runs the game loop without
    `requestAnimationFrame` (background tabs and headless browsers don't get frames).
  - Driving the game: `teleport(x, z, yaw)`, `press(code, ms)`, `sit(seatIndex)`, `stand()`,
    `enter(mode)`, `look(yaw, pitch)`, `shot(cameraPose)` for repeatable screenshots.
  - State queries: seats (and whether each prompt is reachable), props whose rotation
    doesn't match the layout, door angles, loaded sound clips, current zone.
  - Benchmarks: a scripted fly-through of every zone that reports p50/p95 frame time and
    `renderer.info`, to compare before and after a change.
  - A smoke test script (Playwright) that loads the page, enters the office, walks through the
    doorway, sits at a computer, opens the work program, and fails on console errors.
  - The checks done by hand so far belong here: every prop matches its layout rotation,
    every chair faces its table/desk, every seat prompt is reachable, the doors swing.

## Features (queued)

- [ ] Character select: each character's face (with a cheesy smile) instead of the initial.
- [ ] Desk chairs you can roll around in without standing up.
- [ ] Office chair race mode: start it from a spot in the office; the main floor is rearranged
  into a course, and everything goes back when the race ends.
- [ ] Plastic cup stacking game in the break room, on the table at the back.
