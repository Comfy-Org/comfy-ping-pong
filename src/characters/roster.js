/**
 * Character definitions. Models are rigged Meshy humanoids (see RIG in
 * Character.js), facing +Z, any scale — they're auto-scaled to `height`.
 * Set `model: null` to fall back to the placeholder body.
 */
export const ROSTER = {
  matt: {
    id: 'matt',
    name: 'Matt',
    color: 0x3b82f6,
    rubberColor: 0xd32f2f,
    height: 1.78,
    handedness: 'left',
    model: '/models/matt.glb',
    modelYaw: 0,
    emotes: { point: ['point_fist_pump', 'point_flex'], win: 'win_floss' },
  },
  deep: {
    id: 'deep',
    name: 'Deep',
    color: 0xf97316,
    rubberColor: 0x1e88e5,
    height: 1.78,
    handedness: 'right',
    model: '/models/deep.glb',
    modelYaw: 0,
    emotes: { point: ['point_fist_pump', 'point_flex'], win: 'win_victory_jump' },
  },
  steven: {
    id: 'steven',
    name: 'Steven',
    color: 0x22c55e,
    rubberColor: 0xd32f2f,
    height: 1.75,
    handedness: 'right',
    model: '/models/steven.glb',
    modelYaw: 0,
    emotes: { point: ['point_fist_pump', 'point_flex'], win: 'win_victory_jump' },
  },
};

/** Who you can pick in the start menu, in order. */
export const PICKS = ['matt', 'deep', 'steven'];

/**
 * The two players at the table for a pick, and which side is yours. Deep is the
 * opponent unless you are Deep (then it's Matt).
 */
export function lineupFor(pick) {
  if (pick === 'deep') return { characters: [ROSTER.matt, ROSTER.deep], side: 1 };
  return { characters: [ROSTER[pick] ?? ROSTER.matt, ROSTER.deep], side: 0 };
}
