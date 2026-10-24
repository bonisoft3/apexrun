// The kinetic engine the page steps, as the terminal's cage imports it: the
// simulation's contract, re-exported from the module the renderer and the HUD
// read the same tables out of, and what the arena's kinetic child asks of it
// (program.cue `cortex`): the run row as a race's options and view, a key
// mapper's poll as a frame's command.
import { apexrunEngine, viewForSeat } from './simulation.js';

export const { rateHz, initState, advanceFrame, saveState, loadState } = apexrunEngine;
export { decodeCommand, decodeInputs, encodeCommand, encodeInput, milestones, milestoneSnapshots, viewForSeat } from './simulation.js';

/** The run row's race: idling behind the title card, a hot-seat duel on the
 * first stage, an online duel on its machine's stage, or a run from its grid. */
export const optionsOf = ({ phase, mode, stage }) => {
  if (phase === 'title') return { stageState: 'title' };
  if (mode === 'hotseat') return { duel: true, stageId: 'coconut-beach' };
  if (mode === 'online') return { duel: true, stageId: stage };
  return { stageState: 'warmup' };
};

/** An online duel is seen from this side's seat; one on one screen, from the first. */
export const viewOf = (state, { mode, seat }) => (state.duel ? viewForSeat(state, mode === 'online' ? Number(seat) : 0) : state);

/** A mapper's poll as a frame's command: G holds the high gear. */
export const commandOf = (poll) => ({
  up: !!poll.up,
  down: !!poll.down,
  left: !!poll.left,
  right: !!poll.right,
  drift: !!poll.drift,
  nitro: !!poll.nitro,
  enter: !!poll.enter,
  gear: poll.gear ? 'high' : undefined,
});

/** encodeCommand's bytes a frame. */
export const commandWidth = 2;
