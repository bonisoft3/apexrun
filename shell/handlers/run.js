// run — the run machine (pronto's kinetic-machine record): the arena's run
// row, its phase from the title to the saved score, folded from what the
// race lifts and what the player presses.
//
// The kinetic child on the arena (program.cue `cortex`) hands this reduce
// four events: each milestone the race lifts at a confirmed frame, each menu
// press between races, an online race's session description, and the end of
// a replay it was handed. None is applied where it lands. A milestone is put
// as its `run_milestone` row, a press, a click or a replay's end as a
// `run_input` row and a description as a `run_signal` row, so the one seated
// fold (data-on-mutation, every region declaring the same reads) applies them
// in order and no two steps race over the run. What the run row says is what
// the race is handed back: a new seed is a new race, `input` and `clock` say
// who drives and whether it plays, and `replay` the windows of its own run it
// plays back.
//
// A goal (DESIGN.md "End of a run") is three phases: the arrival, where the
// race plays on as the car drives itself into its ending's destination; the
// replay, the run's road trip, a window around each raced stage's landmark
// rebuilt from the rows (pronto's kinetic-machine record: the landmark
// milestone carries its frame's state, the next one the commands since); and
// the results.
//
// An online duel is the duel machine's (machines/duel.cue): the racer's seat
// in it, once the lobby's challenge opens it, starts the race from its seed
// and stage, hands the race the peer's description, and says how it ended.
// The lobby's fold (machines/lobby.js) writes what the race sends it.
(state, event) => {
  const rows = state.rows ?? {};
  // The words the shared table refuses (program.cue _initialsCel).
  const DENIED = ['ASS', 'CUM', 'FAG', 'FCK', 'FUC', 'FUK', 'KKK', 'NIG', 'SEX', 'TIT'];
  // shell/engine/sound.js STATIONS, then the radio off.
  const STATIONS = 3;
  const A = 'A'.charCodeAt(0);
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  // A replay window's frames, seven seconds a stage: a multiple of three, so
  // its commands are a prefix of the base64 a row carries.
  const WINDOW_FRAMES = 420;

  const grouped = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const time = (ticks) => (ticks === null ? '—' : `${Math.floor(ticks / 3600)}:${((ticks % 3600) / 60).toFixed(1).padStart(4, '0')}`);
  const shift = (letter, by) => String.fromCharCode(A + (letter.charCodeAt(0) - A + by + 26) % 26);

  // The race's two events become rows, keyed by what they are: a milestone
  // twice is one row, and a press is its press count on this page.
  if (event.type === 'milestone') {
    const d = event.detail;
    const id = `${d.race}:${d.frame}:${d.kind}`;
    return {
      updates: [{
        op: 'put',
        entity: 'run_milestone',
        id,
        row: {
          id, race: Number(d.race), frame: d.frame, kind: d.kind, checksum: String(d.checksum), from: d.from, width: d.width, inputs: d.inputs,
          detail: JSON.stringify(d.detail), snapshot: d.snapshot === undefined ? '' : JSON.stringify(d.snapshot),
        },
      }],
    };
  }
  if (event.type === 'describe') {
    const d = event.detail;
    return { updates: [{ op: 'put', entity: 'run_signal', id: d.race, row: { id: d.race, description: d.description } }] };
  }
  if (event.type === 'menu') {
    const id = `m${event.detail.n}`;
    return { updates: [{ op: 'put', entity: 'run_input', id, row: { id, n: Number(event.detail.n), action: event.detail.action } }] };
  }
  if (event.type === 'replayed') {
    const id = `r${event.detail.race}`;
    return { updates: [{ op: 'put', entity: 'run_input', id, row: { id, n: 0, action: 'replayed' } }] };
  }
  // A click is keyed by a draw, and named by the control's id.
  if (event.type === 'click') return { then: { type: 'press', seed: true, with: event.from } };
  if (event.type === 'press') {
    const id = `c${event.seed}`;
    return { updates: [{ op: 'put', entity: 'run_input', id, row: { id, n: 0, action: event.with } }] };
  }

  // The fold. The run row is the stored one, or the slot's empty row before
  // it is stored; a wake that sees neither waits for the slot's.
  const stored = (rows.run ?? [])[0];
  const empty = state.items?.[0]?.phase === undefined ? undefined : state.items[0];
  const before = stored ?? empty;
  if (before === undefined) return {};
  let run = { ...before };
  let then;

  const stage = (card) => ({
    stage_id: card.stageId,
    stage_num: card.stageNum,
    next_num: card.stageNum + 1,
    stage_name: card.stageName.toUpperCase(),
    final: card.fork === null ? 'yes' : 'no',
    fork_left: card.fork === null ? '' : card.fork[0],
    fork_right: card.fork === null ? '' : card.fork[1],
    rival_label: run.mode === '' ? `RIVAL · STAGE ${card.stageNum}` : 'OPPONENT · DUEL',
  });
  const lines = (pairs) => Object.fromEntries([0, 1, 2, 3].flatMap((i) => [
    [`line${i + 1}_label`, pairs[i]?.[0] ?? ''],
    [`line${i + 1}_value`, pairs[i]?.[1] ?? ''],
  ]));
  const ended = (d) => ({ phase: 'ended', input: 'menu', racing: 'no', ...d });
  // The ending's set piece plays on the race's own clock.
  const arrival = (d) => ({ phase: 'arrival', input: 'menu', racing: 'no', ...d });
  const settle = (d) => {
    then = { type: 'settled', delay: d.holdMs };
  };

  const milestone = {
    grid: (d) => ({ ...stage(d), route: d.stageId }),
    start: () => ({ racing: 'yes' }),
    landmark: () => ({}),
    checkpoint: (d) => ({ ...stage(d.next), route: `${run.route} ${d.next.stageId}` }),
    // A duel's clock running out is its finish's, which follows.
    'time-over': (d) => {
      if (d.duel) return {};
      settle(d);
      return ended(result(d, false));
    },
    finish: (d) => {
      settle(d);
      return arrival(result(d, true));
    },
    'duel-finish': (d) => {
      settle(d);
      // A duel on one screen is seen from the first seat.
      const mine = run.mode === 'online' ? run.seat : 0;
      return ended({
        res_title: d.winner === null ? 'DRAW' : d.winner === mine ? 'YOU WIN!' : 'YOU LOSE',
        res_over: d.winner !== null && d.winner !== mine ? 'yes' : 'no',
        res_kicker: `DUEL · ${d.stageName.toUpperCase()}`,
        ...lines([['You', time(d.goal[mine])], ['Opponent', time(d.goal[1 - mine])]]),
        total: '',
      });
    },
  };
  // The end-of-run card: how the run ended, then its score line by line.
  function result(d, goal) {
    const { entry, lines: points } = d;
    return {
      res_title: goal ? 'GOAL!' : 'TIME OVER',
      res_over: goal ? 'no' : 'yes',
      res_kicker: goal
        ? `ALL ${d.finalStage} STAGES CLEARED · ENDING ${entry.outcome} · ${d.stageName.toUpperCase()}`
        : `REACHED STAGE ${d.stageNum} OF ${d.finalStage} · ${d.stageName.toUpperCase()}`,
      ...lines([
        [`Distance · ${(d.metres / 1000).toFixed(1)} km`, grouped(points.distance)],
        [`Close passes · ${d.closePasses} × ${d.perClosePass}`, grouped(points.closePasses)],
        [`Rivals beaten · ${d.rivalsBeaten} × ${grouped(d.perRival)}`, grouped(points.rivals)],
        ...(goal ? [[`Time left · ${(points.timeBonus / 1000).toFixed(1)} s × 1,000`, grouped(points.timeBonus)]] : []),
      ]),
      total: grouped(entry.score),
      outcome: entry.outcome,
      score: entry.score,
      stage: entry.stage,
      run_ms: entry.run_ms,
    };
  }

  // A run that ranks in the live top ten takes initials; any other, the board.
  const qualifies = () => {
    const board = rows.board ?? [];
    return run.mode === '' && (board.length < 10 || run.score > board[9].score);
  };
  const letters = () => `${run.initial_0}${run.initial_1}${run.initial_2}`;
  const slot = (i, letter) => ({ [`initial_${i}`]: letter });
  const effects = [];
  const initials = (action) => {
    const at = run.cursor;
    if (action === 'up' || action === 'down') return { ...slot(at, shift(run[`initial_${at}`], action === 'up' ? 1 : -1)), denied: 'no' };
    if (action === 'left' || action === 'back') return { cursor: Math.max(0, at - 1), denied: 'no' };
    if (action === 'right') return { cursor: Math.min(2, at + 1), denied: 'no' };
    if (action.startsWith('letter_')) return { ...slot(at, action.slice(7).toUpperCase()), cursor: Math.min(2, at + 1), denied: 'no' };
    if (action !== 'confirm' && action !== 'arena-finish-save') return {};
    if (DENIED.includes(letters())) return { denied: 'yes' };
    effects.push({ op: 'create', entity: 'high_score', values: { initials: letters(), score: run.score, outcome: run.outcome, stage: run.stage, run_ms: run.run_ms } });
    return { phase: 'saved', saved: 'yes', saved_score: run.score, saved_initials: letters() };
  };
  // The board, or the initials for a run that ranks, over the race played on.
  const results = () => ({ phase: qualifies() ? 'initials' : 'result', clock: 'play', replay: '' });
  // The run's road trip: a window from each landmark milestone, on the
  // commands its next milestone lifted; none, and the results come at once.
  const trip = () => {
    const ms = (rows.run_milestone ?? []).filter((m) => m.race === run.race).sort((a, b) => a.frame - b.frame);
    const windows = ms.flatMap((m) => {
      // The milestone that lifted the commands since this one: a later frame's
      // first, never another of this frame's, which carries none.
      const then = ms.find((n) => n.frame > m.frame && n.from === m.frame);
      if (m.kind !== 'landmark' || then === undefined) return [];
      const frames = Math.min(WINDOW_FRAMES, then.frame - m.frame);
      return [{
        at: { frame: m.frame, kind: m.kind, checksum: Number(m.checksum), from: m.from, width: m.width, inputs: '', snapshot: JSON.parse(m.snapshot) },
        commands: frames === WINDOW_FRAMES ? then.inputs.slice(0, (WINDOW_FRAMES * then.width / 3) * 4) : then.inputs,
        frames,
      }];
    });
    return windows.length === 0 ? results() : { phase: 'replay', clock: 'hold', replay: JSON.stringify({ windows }) };
  };
  const racing = { phase: 'race', input: 'car', clock: 'play' };
  const paused = { phase: 'paused', input: 'menu', clock: 'hold' };
  const station = (index) => ({ station: index });
  // Every phase's presses; a new race waits on a draw.
  const press = (action) => {
    if (action === 'stk-radio-skip') return station(run.station + 1 < STATIONS ? run.station + 1 : -1);
    if (action === 'stk-radio-mute') return { muted: run.muted === 'true' ? 'false' : 'true' };
    if (action.startsWith('stk-station-')) return station(Number(action.slice(12)));
    if (action === 'pitlane-toggle' || action === 'pitlane-close' || action === 'stk-btn-pit') return { pitlane: run.pitlane === 'yes' ? 'no' : 'yes' };
    if (run.phase === 'title' && (action === 'confirm' || action === 'stk-btn-start')) then = { type: 'race', seed: true };
    if (run.phase === 'title' && (action === 'duel' || action === 'stk-btn-duel')) then = { type: 'race', seed: true, with: 'hotseat' };
    if (action === 'stk-pause-restart' || action === 'stk-res-restart') then = { type: 'race', seed: true };
    if (action === 'stk-res-lobby') then = { type: 'title', seed: true };
    // An online race runs on both racers' clocks, which neither holds.
    if (run.phase === 'race' && run.mode !== 'online' && (action === 'pause' || action === 'stk-pause-btn')) return paused;
    if (run.phase === 'paused' && (action === 'pause' || action === 'stk-pause-resume')) return racing;
    if (run.phase === 'initials') return initials(action);
    if (run.phase === 'replay' && (action === 'confirm' || action === 'replayed')) return results();
    return {};
  };

  const lifted = (rows.run_milestone ?? []).filter((m) => m.race === run.race && m.frame > run.lifted).sort((a, b) => a.frame - b.frame);
  for (const m of lifted) {
    run = { ...run, ...milestone[m.kind](JSON.parse(m.detail)), lifted: m.frame };
  }
  // Presses in the order they were made, up to one that waits on a draw or a
  // beat; those after it are the next wake's.
  const done = [];
  for (const input of [...(rows.run_input ?? [])].sort((a, b) => a.n - b.n)) {
    if (then !== undefined) break;
    done.push(input.id);
    if (run.phase === 'ended' || run.phase === 'arrival') continue;
    run = { ...run, ...press(input.action) };
  }

  const fresh = (seed, mode) => ({
    ...racing,
    seed,
    race: seed,
    mode,
    lifted: 0,
    racing: 'no',
    initial_0: 'A',
    initial_1: 'A',
    initial_2: 'A',
    cursor: 0,
    denied: 'no',
    saved: 'no',
    seat: 0,
    duel_stage: '',
    peer: '',
    verdict: '',
    replay: '',
  });
  // Racing again keeps a hot-seat duel's keyboard; an online duel is raced once.
  // The title idles a race of its own behind its card.
  if (event.type === 'title') run = { ...run, ...fresh(event.seed >>> 1, ''), phase: 'title', input: 'menu' };
  if (event.type === 'race') run = { ...run, ...fresh(event.seed >>> 1, event.with ?? (run.mode === 'online' ? '' : run.mode)) };

  // The racer's seat in a duel still being raced, and not raced here yet
  // (`duel` names the last one), is the race the arena runs, from the duel's
  // seed on its stage; the peer's description reaches it once
  // the machine holds one, and how the machine ended the duel is the card's.
  const seats = rows.apexrun_duel_seat ?? [];
  const open = seats.find((s) => (s.phase === 'signalling' || s.phase === 'racing') && s.instance_id !== run.duel);
  if (open !== undefined) {
    run = { ...run, ...fresh(open.view.seed, 'online'), duel: open.instance_id, seat: open.seat === 'a' ? 0 : 1, duel_stage: open.view.stage };
  }
  const duel = run.mode === 'online' ? seats.find((s) => s.instance_id === run.duel) : undefined;
  if (duel !== undefined) {
    const { winner } = duel.view;
    const verdict = duel.phase === 'finished' ? (winner === 'draw' ? 'draw' : winner === duel.seat ? 'won' : 'lost')
      : duel.phase === 'signalling' || duel.phase === 'racing' ? 'pending' : duel.phase;
    run = { ...run, peer: duel.view.peer, verdict };
    // A duel the machine gave up on before its race ended ends the race.
    if (duel.phase === 'abandoned' && (run.phase === 'race' || run.phase === 'ended')) {
      run = { ...run, phase: 'result', input: 'menu', racing: 'no', res_title: 'NO CONTEST', res_over: 'yes', res_kicker: 'DUEL · ABANDONED', ...lines([]), total: '' };
    }
  }
  if (event.type === 'settled' && run.phase === 'ended') run = { ...run, phase: qualifies() ? 'initials' : 'result' };
  if (event.type === 'settled' && run.phase === 'arrival') run = { ...run, ...trip() };
  if (event.type === 'refused' && event.entity === 'high_score') run = { ...run, saved: 'refused' };

  const changed = Object.fromEntries(Object.entries(run).filter(([k, v]) => stored === undefined || stored[k] !== v));
  const updates = [
    ...(stored === undefined ? [{ op: 'put', entity: 'run', id: run.id, row: run }] : Object.keys(changed).length > 0 ? [{ op: 'patch', entity: 'run', id: run.id, row: changed }] : []),
    ...done.map((id) => ({ op: 'delete', entity: 'run_input', id })),
  ];
  return { updates, effects, then };
}
