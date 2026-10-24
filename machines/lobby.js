// lobby — the title card's online lobby: your presence among the racers,
// leased while the arena is open (program.cue `cortex`), composed over
// apexrun_presence and handed the declarations of the challenges it opens and
// the duels they start, whose rows it writes for the race the arena runs.
//
// The tab holds one lease row, keyed by the terminal's draw and renewed by the
// `lease` handler; the cluster lists you while a lease of yours is live, so a
// tab that closes stops listing you when its lease lapses. A gesture becomes
// a command or an open row; a challenge is keyed by a draw, since an
// instance's id is a uuid and a fold has no randomness but the terminal's.
(state, event, machine, machines) => {
  const rows = state.rows ?? {};
  const txt = value => String(value);

  // A uuid from four recorded draws, laid out as the terminal's own keys are,
  // so a replay opens the same one. A draw is 32 bits: the draws an id asks
  // for are gathered one step each, carried in `with`.
  const uuidOf = draws => {
    const hex = draws.map(n => (Number(n) >>> 0).toString(16).padStart(8, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${"89ab"[parseInt(hex[16], 16) % 4]}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  };
  // A challenge draws its id and, after it, the seed its duel is raced from.
  const needed = {lease: 4, offer: 5}[event.type] ?? 0;
  const draws = needed > 0 ? [...(event.with?.draws ?? []), event.seed] : [];
  if (draws.length < needed) return {updates: [], then: {type: event.type, seed: true, with: {...event.with, draws}}};

  const tab = (rows.lobby_tab ?? []).find(r => r.id === "the");
  const presence = (rows.apexrun_presence_seat ?? [])[0];
  const note = text => tab === undefined || tab.note === text ? [] : [{op: "patch", entity: "lobby_tab", id: "the", row: {note: text}}];
  // A milestone row as the duel machine joins it: a finish carries who won
  // (a seat, or a draw) and each car's frames to its goal, -1 for none.
  const lifted = m => {
    const detail = JSON.parse(m.detail);
    const finish = m.kind === "duel-finish";
    return {
      frame: Number(m.frame), kind: m.kind, checksum: txt(m.checksum), inputs: m.inputs,
      winner: !finish ? "" : detail.winner === null ? "draw" : ["a", "b"][detail.winner],
      goal_a: finish ? detail.goal[0] ?? -1 : -1, goal_b: finish ? detail.goal[1] ?? -1 : -1,
    };
  };
  const command = (name, instance, revision, seat, kind, payload) => {
    const id = `${instance}/${revision}/${seat}/${kind}`;
    const request = {version: machines[name].spec.version, expected_revision: txt(revision), event: {kind, payload}};
    return {op: "put", entity: `${name}_command`, id, row: {id, instance_id: instance, request}};
  };

  // The lease is drawn once per tab, and names the racer: a callsign from it.
  if (event.type === "lease") {
    const id = uuidOf(draws);
    return {updates: [
      {op: "put", entity: "lobby_tab", id: "the", row: {id: "the", lease: id, me: "", note: "", shown: "", open: "no", offer: "", stage: "coconut-beach", name: `RACER ${id.slice(0, 4).toUpperCase()}`}},
      {op: "put", entity: "apexrun_presence_lease", id, row: {id, beat: 0}},
    ]};
  }
  if (event.type === "offer") {
    const id = uuidOf(draws.slice(0, 4));
    return {updates: [
      {op: "put", entity: "apexrun_challenge_open", id, row: {id, instance_id: id, kind: "create", input: {target: event.with.target, stage: tab.stage, seed: (Number(draws[4]) >>> 0) >>> 1}}},
      {op: "patch", entity: "lobby_tab", id: "the", row: {offer: id}},
    ]};
  }

  if (event.type === "click") {
    const from = event.from ?? "";
    if (from === "stk-btn-lobby" || from === "btn-lobby-close") return {updates: [{op: "patch", entity: "lobby_tab", id: "the", row: {open: from === "stk-btn-lobby" ? "yes" : "no"}}]};
    if (from.startsWith("stage-")) return {updates: [{op: "patch", entity: "lobby_tab", id: "the", row: {stage: from.slice("stage-".length)}}]};
    if (from === "btn-toggle-online") {
      if (presence === undefined) return {updates: []};
      // The switch answers what it shows, which may be ahead of the seat.
      const visible = (tab?.shown || (presence.phase === "visible" ? "show" : "hide")) === "show";
      return {updates: [
        ...note(""),
        {op: "patch", entity: "lobby_tab", id: "the", row: {shown: visible ? "hide" : "show"}},
        command("apexrun_presence", presence.instance_id, presence.revision, presence.seat, visible ? "hide" : "show", visible ? {} : {name: tab.name}),
      ]};
    }
    if (from.startsWith("challenge-")) return {updates: note(""), then: {type: "offer", seed: true, with: {target: event.id}}};
    const answer = ["accept", "decline", "cancel"].find(kind => from.startsWith(`${kind}-`));
    const offer = (rows.apexrun_challenge_seat ?? []).find(c => c.id === event.id);
    if (answer && offer) return {updates: [command("apexrun_challenge", offer.instance_id, offer.revision, offer.seat, answer, {})]};
    return {updates: []};
  }

  if (tab === undefined || tab.lease === "") return {updates: [], then: {type: "lease", seed: true}};
  // Who you are among the racers, so the list leaves you out.
  const me = presence?.instance_id ?? "";
  // A lease renewal moves the revision under a click, so this tab's last
  // switch can come back stale; while the seat is not where it asked to be,
  // it is sent again at the revision the seat holds now. A backgrounded tab
  // whose lease lapsed on the cluster re-puts its lease and resends show once
  // the renewed lease advances the seat's revision.
  const [last] = (rows.apexrun_presence_command ?? [])
    .map(c => ({row: c, revision: Number(txt(c.id).split("/")[1]), kind: txt(c.id).split("/")[3]}))
    .filter(c => presence !== undefined && c.row.instance_id === presence.instance_id && ["show", "hide"].includes(c.kind))
    .sort((x, y) => y.revision - x.revision);
  const lease = (rows.apexrun_presence_lease ?? []).find(l => l.id === tab.lease);
  const disconnected = last !== undefined && last.row.reason === "disconnected" && Number(presence.revision) === last.revision && presence.phase !== "visible";
  const relist = presence !== undefined && (lease === undefined || (disconnected && Number(lease.beat) <= last.revision))
    ? [{op: "put", entity: "apexrun_presence_lease", id: tab.lease, row: {id: tab.lease, beat: disconnected ? last.revision + 1 : 0}}] : [];
  const unmet = last !== undefined && ["stale_revision", "disconnected"].includes(last.row.reason) && Number(presence.revision) > last.revision &&
    (presence.phase === "visible") !== (last.kind === "show");
  // Shown is what you asked for while a switch of yours is in flight, and
  // what the seat holds once none is: a refused switch shows the seat again.
  const inFlight = presence !== undefined && ((rows.apexrun_presence_command ?? []).some(c => c.instance_id === presence.instance_id && !c.outcome) || disconnected);
  const held = presence === undefined ? "" : presence.phase === "visible" ? "show" : "hide";
  const shown = inFlight ? txt(tab.shown ?? "") || held : held;
  // The duel the arena races (the run row's), while its machine signals or
  // races it: the race's description goes once, then each milestone it
  // lifted, oldest first. One command goes at the revision the seat holds; a
  // peer's step that moved it under the command makes it stale, and the next
  // wake sends it again at the new one.
  const run = (rows.run ?? [])[0];
  const duel = (rows.apexrun_duel_seat ?? []).find(d => d.instance_id === run?.duel && ["signalling", "racing"].includes(d.phase));
  const waiting = duel === undefined || (rows.apexrun_duel_command ?? []).some(c => txt(c.id).startsWith(`${duel.instance_id}/${duel.revision}/`));
  const signal = duel === undefined ? undefined : (rows.run_signal ?? []).find(s => txt(s.id) === txt(run.race));
  const [owed] = duel === undefined ? [] : (rows.run_milestone ?? [])
    .filter(m => txt(m.race) === txt(run.race) && !duel.view.lifted.some(l => l.frame === Number(m.frame) && l.kind === m.kind && l.by.includes(duel.seat)))
    .sort((x, y) => Number(x.frame) - Number(y.frame));
  const toDuel = waiting ? []
    : duel.phase === "signalling" && !duel.view.described && signal !== undefined ? [command("apexrun_duel", duel.instance_id, duel.revision, duel.seat, "describe", {description: signal.description})]
    : duel.phase === "racing" && owed !== undefined ? [command("apexrun_duel", duel.instance_id, duel.revision, duel.seat, "lift", lifted(owed))]
    : [];
  // The challenge you last made, once the cluster answers it: a refusal says why.
  const made = (rows.apexrun_challenge_open ?? []).find(o => o.id === txt(tab.offer ?? "") && o.outcome);
  return {updates: [
    ...toDuel,
    ...relist,
    ...(made === undefined ? [] : [{op: "patch", entity: "lobby_tab", id: "the", row: {offer: "", note: made.outcome === "rejected" ? made.reason : ""}}]),
    ...(txt(tab.me ?? "") === me ? [] : [{op: "patch", entity: "lobby_tab", id: "the", row: {me}}]),
    ...(txt(tab.shown ?? "") === shown ? [] : [{op: "patch", entity: "lobby_tab", id: "the", row: {shown}}]),
    ...(unmet ? [command("apexrun_presence", presence.instance_id, presence.revision, presence.seat, last.kind, last.kind === "show" ? {name: tab.name} : {})] : []),
  ]};
}
