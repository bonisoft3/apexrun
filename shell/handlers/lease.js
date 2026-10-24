// lease — renews this tab's presence lease on the terminal's clock. A fold's
// seat is held through its waits, so the renewal sits on its own: the lobby's
// fold never waits a beat for it. A renewal carries the beat it was armed at,
// so one armed twice renews once.
(state, event) => {
  const RENEW = 10000;
  const [lease] = state.items ?? [];
  if (lease === undefined) return {updates: []};
  if (event.type === "renew") {
    if (Number(lease.beat) !== event.with.beat) return {updates: []};
    return {updates: [{op: "patch", entity: "apexrun_presence_lease", id: lease.id, row: {beat: event.with.beat + 1}}]};
  }
  return {updates: [], then: {type: "renew", delay: RENEW, with: {beat: Number(lease.beat)}}};
}
