# Apex Run — Acceptance Criteria

## Functional Criteria
- [ ] Opening the arena lands on the title card over the first stage, with the car on the road and the controls shown. {#accept-instant-arena}
- [ ] Speed, stage and nitro display racing telemetry. {#accept-speedometer}
- [ ] A run that ranks in the shared top ten takes three initials, and the saved row shows live on every player's board with its ending, time and score. {#accept-high-score}
- [ ] A save the table refuses, and initials it denies, are said on the form; no run is lost silently. {#accept-score-refused}
- [x] **Full-Frame Presentation**: the game fills the viewport edge to edge, with no outer frame.
- [x] **Title Card**: start prompt, radio stations, volume and keyboard guide, drawn over the stage.
- [x] **Deterministic 60 Hz Engine**: follows Pronto's kinetic engine contract (`initState`, `advanceFrame`, `saveState`, `loadState`).
- [x] **Driving**: acceleration, gears, steering, drifting, off-road slowdown and nitro.
- [x] **Route and Clock**: five stages a run through a fifteen-stage route tree, a fork at each stage's end, checkpoint extensions, five endings and TIME OVER.
- [x] **Traffic and Rival**: traffic with close-pass points, and one named rival a stage.
- [x] **Universal Input**: `createKineticInput` with dual `code`/`key` matching and the W3C Gamepad API.
- [x] **Telemetry HUD**: glass panels for stage, time, route, radio and speed, cut to the race's own readouts on a phone.
- [x] **Formal Test Battery**: kinetic engine invariants, the simulation, renderer, scenery, audio and initials pass.
