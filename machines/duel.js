// Long enough for both racers' stages to load and a duel's whole clock to
// run, 80 s from the grid; once one racer has lifted the finish, the other
// has this long to lift theirs.
const WAITING_MS = 600000;
const SIGNAL_MS = 30000;
const RACE_MS = 150000;
const FINISH_MS = 15000;
const SEATS = ["a", "b"];
const key = lift => `${lift.frame}:${lift.kind}`;
const finish = state => state.lifts.find(lift => lift.kind === "duel-finish" && lift.by.length === 2);
// What two rows of one milestone must agree on to be one fact.
const AGREED = ["checksum", "inputs", "winner", "goal_a", "goal_b"];
return {
  initial: ({input: {_time, ...input}}) => ({
    ...input, phase: "waiting", seats: SEATS, offer: "", answer: "", deadline: _time + WAITING_MS,
    lifts: [], winner: "", goal_a: -1, goal_b: -1, dispute: "", silent: [],
  }),
  invariant: state => state.lifts.every((lift, i) => state.lifts.findIndex(other => key(other) === key(lift)) === i && lift.by.length > 0)
    && (state.phase !== "finished" || finish(state) !== undefined)
    && (state.phase !== "disputed" || state.dispute !== ""),
  project: (state, viewer) => ({
    stage: state.stage, seed: state.seed, deadline: state.deadline,
    peer: viewer === "a" ? state.answer : state.offer,
    described: (viewer === "a" ? state.offer : state.answer) !== "",
    lifted: state.lifts.map(({frame, kind, by}) => ({frame, kind, by})),
    winner: state.winner, goal_a: state.goal_a, goal_b: state.goal_b, dispute: state.dispute, silent: state.silent, phase: state.phase,
  }),
  allSeated: ({event}) => SEATS.every(seat => event.seats.includes(seat)),
  start: ({context: state, event}) => ({...state, deadline: event._time + SIGNAL_MS}),
  mayCancel: ({context: state, event}) => event._origin === "a" || (state.phase !== "waiting" && event._origin === "b"),
  cancel: ({context: state}) => ({...state, deadline: 0}),
  // The challenger offers first; the target answers the offer.
  undescribed: ({context: state, event}) => (event._origin === "a" ? state.offer : state.answer) === "",
  offerStands: ({context: state, event}) => event._origin !== "b" || state.offer !== "",
  describe: ({context: state, event}) => ({...state, [event._origin === "a" ? "offer" : "answer"]: event.description}),
  connected: ({context: state}) => state.offer !== "" && state.answer !== "",
  race: ({context: state, event}) => ({...state, deadline: event._time + RACE_MS}),
  unlifted: ({context: state, event}) => !state.lifts.some(lift => key(lift) === key(event) && lift.by.includes(event._origin)),
  // The first row of a milestone is held; the second joins it if it agrees,
  // and is the duel's dispute if it does not.
  lift: ({context: state, event}) => {
    const {type: _type, _origin, _time, ...row} = event;
    const held = state.lifts.find(lift => key(lift) === key(row));
    if (held === undefined) {
      const due = row.kind === "duel-finish" ? Math.min(state.deadline, event._time + FINISH_MS) : state.deadline;
      return {...state, lifts: [...state.lifts, {...row, by: [event._origin]}], deadline: due};
    }
    if (AGREED.some(field => held[field] !== row[field])) return {...state, dispute: key(row)};
    return {...state, lifts: state.lifts.map(lift => lift === held ? {...lift, by: SEATS.filter(seat => lift.by.includes(seat) || seat === event._origin)} : lift)};
  },
  desynced: ({context: state}) => state.dispute !== "",
  settled: ({context: state}) => finish(state) !== undefined,
  decide: ({context: state}) => {
    const {winner, goal_a, goal_b} = finish(state);
    return {...state, winner, goal_a, goal_b, deadline: 0};
  },
  isDue: ({context: state, event}) => event._time >= state.deadline,
  // Who had not answered when the clock ran out: a description, or the finish.
  timeout: ({context: state}) => ({...state, deadline: 0, silent: state.phase === "waiting" ? [] : SEATS.filter(seat => state.phase === "signalling"
    ? (seat === "a" ? state.offer : state.answer) === ""
    : !state.lifts.some(lift => lift.kind === "duel-finish" && lift.by.includes(seat)))}),
};
