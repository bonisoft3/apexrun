// The platform this app's tests run against: omnishell where mise puts it,
// under its own test config (pronto's docs/monorepo.md).
import "@bonisoft3/omnishell/interpreter/vendor/ses.umd.min.js";
export { default as ggrsWasm } from "@bonisoft3/omnishell/interpreter/vendor/ggrs/ggrs_wasm_bg.wasm" with { type: "bytes" };
export { baseUrl } from "@bonisoft3/omnishell/base-url.ts";
export { evaluateEngine, evaluateHandler } from "@bonisoft3/omnishell/interpreter/jessie.js";
export { attachTouch, canonical, checksum, createKineticHost, createKineticInput } from "@bonisoft3/omnishell/interpreter/kinetic.js";
export { loadMilestone, unpackInputs } from "@bonisoft3/omnishell/interpreter/kinetic-milestones.js";
export { kineticChild } from "@bonisoft3/omnishell/interpreter/kinetic-mount.js";
export { createRollbackHost } from "@bonisoft3/omnishell/interpreter/kinetic-session.js";
export { type Machine } from "@bonisoft3/omnishell/test/mecha-battery.ts";
export { executeMecha } from "@bonisoft3/omnishell/test/mecha-local.ts";
