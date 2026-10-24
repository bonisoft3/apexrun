const live = (state, context) => state.leases.filter(lease => lease.until > context.now);
const leased = (state, leases) => ({...state, leases, until: leases.reduce((soonest, lease) => soonest === 0 ? lease.until : Math.min(soonest, lease.until), 0)});
return {
  initial: () => ({phase: "hidden", name: "", leases: [], until: 0}),
  invariant: state => state.leases.every((lease, i) => state.leases.findIndex(other => other.id === lease.id) === i)
    && state.until === state.leases.reduce((soonest, lease) => soonest === 0 ? lease.until : Math.min(soonest, lease.until), 0),
  project: state => ({...state}),
  publish: state => state.phase === "visible" && state.leases.length > 0 ? {name: state.name} : null,
  mayShow: (state, event, context) => !event.payload.name.trim() ? "name_required" : live(state, context).length ? true : "disconnected",
  show: (state, event) => ({...state, name: event.payload.name.trim()}),
  hasCapacity: (state, event, context) => live(state, context).filter(lease => lease.id !== event.payload.session).length < 16 ? true : "too_many_tabs",
  touch: (state, event, context) => leased(state, [...live(state, context).filter(lease => lease.id !== event.payload.session), {id: event.payload.session, until: context.now + 30000}]),
  leave: (state, event, context) => leased(state, live(state, context).filter(lease => lease.id !== event.payload.session)),
  expire: (state, _event, context) => leased(state, live(state, context)),
};
