return {
  initial: ({input: {_time, ...input}}) => ({...input, phase: "offered", deadline: _time + 30000}),
  invariant: state => state.inviter !== state.target && state.inviter.length === 36 && state.target.length === 36 && state.duel.length === 36,
  project: state => ({...state}),
  isTarget: ({event}) => event._origin === "target",
  isInviter: ({event}) => event._origin === "inviter",
  inTime: ({context: state, event}) => event._time < state.deadline,
  isDue: ({context: state, event}) => event._time >= state.deadline,
};
