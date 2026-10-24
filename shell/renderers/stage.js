// A duel's stage id as its name on the road signs (shell/engine/simulation.js
// OUTRUN_STAGES).
(value) => [String(value).split("-").map((word) => word.toUpperCase()).join(" ")];
