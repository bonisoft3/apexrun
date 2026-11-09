//! Native macOS application binary (`apexrun-mac`) launching `OmnishellDesktopHost`
//! with AppKit (`omnishell-winio`), Metal (`omnishell-bevy-presenter`), CoreAudio (`omnishell-audio`),
//! and JavaScriptCore (`apps/apexrun/shell/engine/simulation.js` + `pose_buffer.js`).

fn main() {
    apexrun_desktop_host::macos_ffi::run_macos_app();
}
