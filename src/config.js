// All tunables live here. Units are meters / seconds (ITTF regulation sizes).
// Coordinate system: table is centered at the origin, long axis along Z.
// Side 0 (human by default) plays from +Z, side 1 (AI) from -Z.

export const TABLE = {
  length: 2.74,
  width: 1.525,
  height: 0.76,
  thickness: 0.03,
  netHeight: 0.1525,
  netOverhang: 0.1525,
};

export const BALL = {
  radius: 0.02,
  visualScale: 1.25, // drawn slightly larger than real so it reads on screen
  restitution: 0.88, // table bounce (vertical). Trajectory solver assumes this too.
  netRestitution: 0.15,
  floorRestitution: 0.55,
};

export const PHYSICS = {
  gravity: 9.81,
  step: 1 / 240, // fixed physics step
  maxStepsPerFrame: 40,
  timeScale: 0.85, // < 1 slows the whole sim down for playability
};

export const PLAY = {
  hitPlaneZ: 1.6, // distance from net where each side contacts the ball
  reach: 0.19, // contact radius around paddle center (forgiving)
  paddleMinY: 0.8,
  paddleMaxY: 1.7,
  paddleMaxX: 1.15,
  tossSpeed: 2.2,
  rallyTimeout: 8, // seconds without a hit before the point is force-resolved
  pointPause: 1.5, // seconds between points
};

export const SHOTS = {
  humanSpeed: 5.6, // horizontal m/s
  humanPowerSpeed: 8.5, // when mouse is held at contact
  humanAimGain: 0.3, // paddle lateral velocity -> target x
};

// spinUse: how much spin the AI puts on shots (rad/s). spinControl: 0..1, how well it handles incoming spin.
export const DIFFICULTY = {
  easy: { label: 'Easy', paddleSpeed: 2.2, positionError: 0.15, aimError: 0.24, shotSpeed: 4.8, mistakeRate: 0.2, spinUse: 30, spinControl: 0.4, superUse: 0.4 },
  medium: { label: 'Medium', paddleSpeed: 3.2, positionError: 0.11, aimError: 0.16, shotSpeed: 5.8, mistakeRate: 0.11, spinUse: 70, spinControl: 0.65, superUse: 0.7 },
  hard: { label: 'Hard', paddleSpeed: 4.6, positionError: 0.07, aimError: 0.09, shotSpeed: 7.0, mistakeRate: 0.05, spinUse: 115, spinControl: 0.85, superUse: 1 },
};

/**
 * Spin is the ball's angular velocity (rad/s, world space).
 * In the air it curves the ball (Magnus); on the table, friction trades spin for speed:
 * topspin kicks forward and low, backspin checks up and sits, no-spin picks up topspin.
 */
export const SPIN = {
  magnus: 0.006, // accel = magnus * (spin x velocity)
  decay: 0.35, // fraction lost per second in the air
  tableFriction: 0.12, // friction coefficient at the bounce (higher = spin kicks harder, but flat balls die too)
  max: 160, // rad/s cap (about 25 rev/s)
  humanTopGain: 30, // paddle vertical speed (m/s) at contact -> topspin (brush up) / backspin (chop down)
  humanSideGain: 22, // paddle sideways speed -> sidespin
  incomingError: 1.3, // vertical launch error (m/s) from a max-spin ball that isn't controlled
  passiveControl: 0.25, // how much incoming spin a still paddle handles
};

/** Super meter: fills during play; when full, arm it to make your next hit a smash. */
export const SUPER = {
  perReturn: 0.025,
  perLongRallyHit: 0.012, // extra per return once a rally passes 6 hits
  maxPerRally: 0.12, // cap on what returns can add in one rally (long rallies don't spam supers)
  onPointWon: 0.02,
  onPointLost: 0.07, // comeback fuel
  smashSpeed: 13,
  smashTopspin: 150,
  receiverReach: 0.13, // smashes are harder to get a paddle on (normal reach is PLAY.reach)
  aiErrorMult: 2.2, // AI positioning error multiplier against a smash
  slowmoScale: 0.25,
  slowmoTime: 0.35, // real seconds of hit-stop on a smash
};

export const RULES = {
  pointsToWin: 11,
  winBy: 2,
  servesPerTurn: 2,
};
