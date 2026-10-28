// The platform this app's tests run against: omnishell and pronto at the
// releases .mise.toml installs, by their mirrors' raw URLs. apps/deno.json maps
// both to the checkout in the monorepo.
import "https://raw.githubusercontent.com/bonisoft3/omnishell/v0.20.3/interpreter/vendor/ses.umd.min.js";
export { default as ses } from "https://raw.githubusercontent.com/bonisoft3/omnishell/v0.20.3/interpreter/vendor/ses.umd.min.js" with { type: "text" };
export { default as ggrsWasm } from "https://raw.githubusercontent.com/bonisoft3/omnishell/v0.20.3/interpreter/vendor/ggrs/ggrs_wasm_bg.wasm" with { type: "bytes" };
export { baseUrl } from "https://raw.githubusercontent.com/bonisoft3/omnishell/v0.20.3/base-url.ts";
export { instrument } from "https://raw.githubusercontent.com/bonisoft3/omnishell/v0.20.3/instrument.ts";
export { evaluateEngine, evaluateHandler } from "https://raw.githubusercontent.com/bonisoft3/omnishell/v0.20.3/interpreter/jessie.js";
export { attachTouch, canonical, checksum, createKineticHost, createKineticInput } from "https://raw.githubusercontent.com/bonisoft3/omnishell/v0.20.3/interpreter/kinetic.js";
export { loadMilestone, unpackInputs } from "https://raw.githubusercontent.com/bonisoft3/omnishell/v0.20.3/interpreter/kinetic-milestones.js";
export { kineticChild } from "https://raw.githubusercontent.com/bonisoft3/omnishell/v0.20.3/interpreter/kinetic-mount.js";
export { createRollbackHost } from "https://raw.githubusercontent.com/bonisoft3/omnishell/v0.20.3/interpreter/kinetic-session.js";
export { readCheckInputs } from "https://raw.githubusercontent.com/bonisoft3/pronto/v0.26.3/check-inputs.ts";
export { compileHybrid, type HybridMachine } from "https://raw.githubusercontent.com/bonisoft3/pronto/v0.26.3/hybrid.ts";
export { executeHybrid } from "https://raw.githubusercontent.com/bonisoft3/pronto/v0.26.3/hybrid-local.ts";
