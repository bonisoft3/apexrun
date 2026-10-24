// Long enough for both racers' stages to load and a duel's whole clock to
// run, 80 s from the grid; once one racer has lifted the finish, the other
// has this long to lift theirs.
const SIGNAL_MS = 30000;
const RACE_MS = 150000;
const FINISH_MS = 15000;
const SEATS = ["a", "b"];
const key = lift => `${lift.frame}:${lift.kind}`;
const finish = state => state.lifts.find(lift => lift.kind === "duel-finish" && lift.by.length === 2);
// What two rows of one milestone must agree on to be one fact.
const AGREED = ["checksum", "inputs", "winner", "goal_a", "goal_b"];
return {
  initial: (input, context) => ({
    ...input, phase: "signalling", offer: "", answer: "", deadline: context.now + SIGNAL_MS,
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
  // The challenger offers first; the target answers the offer.
  mayDescribe: (state, _event, context) => (context.actor === "a" ? state.offer : state.answer) !== "" ? "described"
    : context.actor === "b" && state.offer === "" ? "no_offer" : true,
  describe: (state, event, context) => ({...state, [context.actor === "a" ? "offer" : "answer"]: event.payload.description}),
  connected: state => state.offer !== "" && state.answer !== "",
  race: (state, _event, context) => ({...state, deadline: context.now + RACE_MS}),
  mayLift: (state, event, context) => state.lifts.some(lift => key(lift) === key(event.payload) && lift.by.includes(context.actor)) ? "lifted" : true,
  // The first row of a milestone is held; the second joins it if it agrees,
  // and is the duel's dispute if it does not.
  lift: (state, event, context) => {
    const row = event.payload;
    const held = state.lifts.find(lift => key(lift) === key(row));
    if (held === undefined) {
      const due = row.kind === "duel-finish" ? Math.min(state.deadline, context.now + FINISH_MS) : state.deadline;
      return {...state, lifts: [...state.lifts, {...row, by: [context.actor]}], deadline: due};
    }
    if (AGREED.some(field => held[field] !== row[field])) return {...state, dispute: key(row)};
    return {...state, lifts: state.lifts.map(lift => lift === held ? {...lift, by: SEATS.filter(seat => lift.by.includes(seat) || seat === context.actor)} : lift)};
  },
  desynced: state => state.dispute !== "",
  settled: state => finish(state) !== undefined,
  decide: state => {
    const {winner, goal_a, goal_b} = finish(state);
    return {...state, winner, goal_a, goal_b, deadline: 0};
  },
  isDue: (state, _event, context) => context.now >= state.deadline ? true : "not_due",
  // Who had not answered when the clock ran out: a description, or the finish.
  timeout: state => ({...state, deadline: 0, silent: SEATS.filter(seat => state.phase === "signalling"
    ? (seat === "a" ? state.offer : state.answer) === ""
    : !state.lifts.some(lift => lift.kind === "duel-finish" && lift.by.includes(seat)))}),
};
