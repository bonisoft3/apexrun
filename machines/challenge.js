return {
  initial: (input, context) => ({...input, phase: "offered", deadline: context.now + 30000}),
  invariant: state => state.inviter !== state.target && state.inviter.length === 36 && state.target.length === 36 && state.duel.length === 36,
  project: state => ({...state}),
  mayAnswer: (state, _event, context) => context.actor !== "target" ? "not_target" : context.now >= state.deadline ? "expired" : true,
  mayCancel: (state, _event, context) => context.actor !== "inviter" ? "not_inviter" : context.now >= state.deadline ? "expired" : true,
  isDue: (state, _event, context) => context.now >= state.deadline ? true : "not_due",
};
