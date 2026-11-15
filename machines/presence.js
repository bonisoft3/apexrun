const live = (state, event) => state.leases.filter(lease => lease.until > event._time);
const leased = (state, leases) => ({...state, leases, until: leases.reduce((soonest, lease) => soonest === 0 ? lease.until : Math.min(soonest, lease.until), 0)});
return {
  initial: () => ({phase: "hidden", name: "", leases: [], until: 0}),
  invariant: state => state.leases.every((lease, i) => state.leases.findIndex(other => other.id === lease.id) === i)
    && state.until === state.leases.reduce((soonest, lease) => soonest === 0 ? lease.until : Math.min(soonest, lease.until), 0),
  project: state => ({...state}),
  publish: state => state.phase === "visible" && state.leases.length > 0 ? {name: state.name} : null,
  named: ({event}) => event.name.trim() !== "",
  connected: ({context: state, event}) => live(state, event).length > 0,
  show: ({context: state, event}) => ({...state, name: event.name.trim()}),
  hasCapacity: ({context: state, event}) => live(state, event).filter(lease => lease.id !== event.session).length < 16,
  touch: ({context: state, event}) => leased(state, [...live(state, event).filter(lease => lease.id !== event.session), {id: event.session, until: event._time + 30000}]),
  leave: ({context: state, event}) => leased(state, live(state, event).filter(lease => lease.id !== event.session)),
  expire: ({context: state, event}) => leased(state, live(state, event)),
};
