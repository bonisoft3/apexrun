@extern(embed)

package apexrun

import (
	"encoding/json"
	"list"
	"regexp"
	"strings"

	pronto "github.com/bonisoft3/pronto"
	online "github.com/bonisoft3/apexrun/machines:apexmachines"
)

_designMd: _ @embed(file="DESIGN.md", type=text)

// Three arcade letters, less the few a shared public table should not show.
_initialsCel: "this.matches('^[A-Z]{3}$') && this != 'ASS' && this != 'CUM' && this != 'FAG' && this != 'FCK' && this != 'FUC' && this != 'FUK' && this != 'KKK' && this != 'NIG' && this != 'SEX' && this != 'TIT'"

// tests/simulation.test.ts rebuilds this from the engine's clock.
_runClockCel: "(this.outcome in ['A', 'B', 'C', 'D', 'E'] && this.stage == 5 && this.run_ms < 255000) || (this.outcome == 'time_over' && ((this.stage == 1 && this.run_ms == 75000) || (this.stage == 2 && this.run_ms == 120000) || (this.stage == 3 && this.run_ms == 165000) || (this.stage == 4 && this.run_ms == 210000) || (this.stage == 5 && this.run_ms == 255000)))"

// The run row before the fold first stores it: the title over the first
// stage, whatever the race lifts next.
_runEmpty: json.Marshal({
	id: "run", phase: "title", seed: 0, race: 0, mode: "", input: "menu", clock: "play", lifted: 0
	stage_id: "", stage_num: 1, next_num: 2, stage_name: "", final: "no", fork_left: "", fork_right: "", route: "", racing: "no", rival_label: ""
	res_title: "", res_over: "no", res_kicker: "", total: ""
	line1_label: "", line1_value: "", line2_label: "", line2_value: "", line3_label: "", line3_value: "", line4_label: "", line4_value: ""
	outcome: "", score: 0, stage: 1, run_ms: 0
	initial_0: "A", initial_1: "A", initial_2: "A", cursor: 0, denied: "no", saved: "no", saved_score: 0, saved_initials: ""
	station: 0, muted: "false", volume: 70, pitlane: "no"
	duel: "", seat: 0, duel_stage: "", peer: "", verdict: "", replay: ""
})
// What the run machine's fold reads, declared alike on every region it is
// seated on so they share one seat (omnishell's screen.js wireEvents).
_runReads: #"data-reads="run,run_input,run_milestone,apexrun_duel_seat" data-read-board="high_score?order=score.desc,run_ms.asc,id.asc&limit=10""#

// The lobby's tab row before its lease is drawn: what the lobby's regions
// bind until the fold first stores it (machines/lobby.js).
_lobbyEmpty: json.Marshal({id: "the", lease: "", me: "", note: "", shown: "", open: "no", offer: "", stage: "coconut-beach", name: ""})
// What the lobby's fold reads, declared alike on every region it is seated on.
_lobbyReads: #"data-reads="lobby_tab,apexrun_presence_lease,apexrun_presence_seat,apexrun_presence_command,apexrun_challenge_seat,apexrun_challenge_open,apexrun_duel_seat,apexrun_duel_command,run,run_signal,run_milestone""#
// The ten road stages a duel races (machines/challenge.cue #Stage).
_duelStages: strings.Join([for id in online.#Stage.values {
	let name = strings.Join([for w in strings.Split(id, "-") {strings.ToUpper(w)}], " ")
	#"<button type="button" class="stk-lobby-stage" id="stage-\#(id)" data-on-click="lobby">\#(name)</button>"#
}], "\n          ")

_arenaMarkup: #"""
<div class="screen" data-screen="arena" data-theme="terminal">
  <!-- The run row (shell/handlers/run.js): the race below it is handed its
       seed, mode, input and clock, and lifts its milestones back; every card
       on the slow HUD shows a phase or a column of it. -->
  <div class="viewport-box arena-run" data-live="run" data-filter="id=eq.run" data-empty-row='\#(_runEmpty)'
       data-on-mutation="run" \#(_runReads)
       data-phase="{phase}" data-mode="{mode}" data-racing="{racing}" data-final="{final}" data-station="{station}"
       data-pitlane="{pitlane}" data-verdict="{verdict}" data-saved="{saved}" data-denied="{denied}" data-cursor="{cursor}" data-visited="{route}" data-stage="{stage_id}">
    <div class="arena-race" data-kinetic="race" data-on-milestone="run" data-on-menu="run" data-on-describe="run" data-on-replayed="run" role="img" aria-label="Apex Run"
         data-prop-seed="{seed}" data-prop-phase="{phase}" data-prop-mode="{mode}" data-prop-input="{input}" data-prop-clock="{clock}"
         data-prop-seat="{seat}" data-prop-stage="{duel_stage}" data-prop-peer="{peer}" data-prop-replay="{replay}"
         data-prop-station="{station}" data-prop-muted="{muted}" data-prop-volume="{volume}"></div>
    <!-- The shell boots after the first contentful paint; a canvas alone is none. -->
    <p class="arena-loading" role="status">APEX RUN · LOADING</p>
    <canvas data-layer="haze" class="stk-layer" aria-hidden="true"></canvas>
    <div class="stk-plane2">
      <header class="hud-top-bar">
        <div class="hud-top-left">
          <div class="hud-badges-row">
            <div class="hud-slant hud-badge-stage">
              <span class="hud-slant-content">STAGE <span data-text="{stage_num}">1</span></span>
            </div>
            <div class="hud-slant hud-badge-multiplier">
              <span class="hud-slant-content"><canvas data-layer="drift" class="hud-layer" style="width: 16.5ch"></canvas></span>
            </div>
            <span class="hud-mono-sub">CHECKPOINT A-1</span>
          </div>
          <div class="hud-panel hud-stage-card">
            <div class="hud-card-row">
              <h1 class="hud-stage-title" data-text="{stage_name}">COCONUT BEACH</h1>
              <span class="hud-fork-dist"><canvas data-layer="fork-dist" class="hud-layer" style="width: 17ch"></canvas></span>
            </div>
            <div class="hud-progress-track">
              <canvas data-layer="route-progress" class="hud-layer-fill"></canvas>
            </div>
            <div class="hud-score-row">
              <span class="hud-label-dim">SCORE</span>
              <div class="hud-score-val"><canvas data-layer="score" class="hud-layer" style="width: 9ch"></canvas> <span class="hud-unit-gold">PTS</span></div>
            </div>
          </div>
        </div>

        <div class="hud-top-center">
          <div class="hud-panel hud-panel-orange hud-timer-card">
            <span class="hud-timer-label">REMAINING TIME</span>
            <div class="hud-timer-digits">
              <span class="hud-timer-main glow-text-gold"><canvas data-layer="timer" class="hud-layer" style="width: 2.8ch"></canvas></span>
              <span class="hud-timer-dec"><canvas data-layer="timer-dec" class="hud-layer" style="width: 1.9ch"></canvas></span>
              <span class="hud-timer-unit">SEC</span>
            </div>
            <div class="hud-timer-status">
              <span class="hud-pulse-dot"></span>
              <span class="hud-status-text">TIMER ACTIVE</span>
            </div>
          </div>
          <div class="hud-panel hud-rival-card">
            <div class="hud-rival-head"><span data-text="{rival_label}">RIVAL · STAGE 1</span><span class="hud-rival-bonus">+1,000 IF PASSED</span></div>
            <div class="hud-rival-gap"><canvas data-layer="rival-gap" class="hud-layer hud-layer-wide"></canvas></div>
            <div class="hud-rival-bar"><canvas data-layer="rival-fill" class="hud-layer-fill"></canvas></div>
          </div>
        </div>

        <div class="hud-top-right">
          <div class="hud-panel hud-matrix-card">
            <div class="hud-matrix-header">
              <div class="hud-matrix-title-row">
                <span class="hud-cyan-dot"></span>
                <span class="hud-matrix-title">SEGA ROUTE MATRIX</span>
              </div>
              <span class="hud-fork-alert"><canvas data-layer="matrix-fork" class="hud-layer" style="width: 22ch"></canvas></span>
            </div>
            <div class="hud-matrix-body">
              <div class="hud-branches-row">
                <div class="hud-branch-choice branch-left"><span class="hud-fork-on">◀ [L] <span data-text="{fork_left}">DESERT CANYONS</span> <span class="hud-tag-easy">STAGE <span data-text="{next_num}">2</span></span></span><span class="hud-fork-off">🏁 [FINAL DESTINATION]</span></div>
                <div class="hud-branch-choice branch-right"><span class="hud-fork-on">[R] <span data-text="{fork_right}">GATEWAY PASS</span> <span class="hud-tag-pro">STAGE <span data-text="{next_num}">2</span></span> ▶</span><span class="hud-fork-off">GOAL AHEAD 🏁</span></div>
              </div>
                <svg class="hud-matrix-svg" viewBox="0 0 200 48">
                <!-- Stage 1 -> Stage 2 Branches -->
                <line x1="100" y1="42" x2="70" y2="34" stroke="#475569" stroke-width="1.5"/>
                <line x1="100" y1="42" x2="130" y2="34" stroke="#475569" stroke-width="1.5"/>
                <!-- Stage 2 -> Stage 3 Branches -->
                <line x1="70" y1="34" x2="50" y2="26" stroke="#475569" stroke-width="1.5"/>
                <line x1="70" y1="34" x2="100" y2="26" stroke="#475569" stroke-width="1.5"/>
                <line x1="130" y1="34" x2="100" y2="26" stroke="#475569" stroke-width="1.5"/>
                <line x1="130" y1="34" x2="150" y2="26" stroke="#475569" stroke-width="1.5"/>
                <!-- Stage 3 -> Stage 4 Branches -->
                <line x1="50" y1="26" x2="35" y2="18" stroke="#475569" stroke-width="1.5"/>
                <line x1="50" y1="26" x2="78" y2="18" stroke="#475569" stroke-width="1.5"/>
                <line x1="100" y1="26" x2="78" y2="18" stroke="#475569" stroke-width="1.5"/>
                <line x1="100" y1="26" x2="122" y2="18" stroke="#475569" stroke-width="1.5"/>
                <line x1="150" y1="26" x2="122" y2="18" stroke="#475569" stroke-width="1.5"/>
                <line x1="150" y1="26" x2="165" y2="18" stroke="#475569" stroke-width="1.5"/>
                <!-- Stage 4 -> Stage 5 Destinations (A, B, C, D, E) -->
                <line x1="35" y1="18" x2="20" y2="10" stroke="#475569" stroke-width="1.5"/>
                <line x1="35" y1="18" x2="60" y2="10" stroke="#475569" stroke-width="1.5"/>
                <line x1="78" y1="18" x2="60" y2="10" stroke="#475569" stroke-width="1.5"/>
                <line x1="78" y1="18" x2="100" y2="10" stroke="#475569" stroke-width="1.5"/>
                <line x1="122" y1="18" x2="100" y2="10" stroke="#475569" stroke-width="1.5"/>
                <line x1="122" y1="18" x2="140" y2="10" stroke="#475569" stroke-width="1.5"/>
                <line x1="165" y1="18" x2="140" y2="10" stroke="#475569" stroke-width="1.5"/>
                <line x1="165" y1="18" x2="180" y2="10" stroke="#475569" stroke-width="1.5"/>

                <!-- Stage Nodes -->
                <circle cx="100" cy="42" r="4.5" stroke="#ffffff" stroke-width="2" class="node-coconut-beach"/>
                <circle cx="70" cy="34" r="3.5" stroke="#00f0ff" stroke-width="1" class="node-desert-canyons"/>
                <circle cx="130" cy="34" r="3.5" stroke="#ff5e00" stroke-width="1" class="node-gateway-pass"/>
                <circle cx="50" cy="26" r="3" stroke="#475569" stroke-width="1" class="node-alpine-peaks"/>
                <circle cx="100" cy="26" r="3" stroke="#475569" stroke-width="1" class="node-wilderness-run"/>
                <circle cx="150" cy="26" r="3" stroke="#475569" stroke-width="1" class="node-tulip-gardens"/>
                <circle cx="35" cy="18" r="3" stroke="#475569" stroke-width="1" class="node-sunset-highway"/>
                <circle cx="78" cy="18" r="3" stroke="#475569" stroke-width="1" class="node-ancient-ruins"/>
                <circle cx="122" cy="18" r="3" stroke="#475569" stroke-width="1" class="node-metropolis-night"/>
                <circle cx="165" cy="18" r="3" stroke="#475569" stroke-width="1" class="node-coastal-cliffs"/>
                <circle cx="20" cy="10" r="3.5" stroke="#ffd700" stroke-width="1" class="node-destination-marina"/>
                <circle cx="60" cy="10" r="3.5" stroke="#ffd700" stroke-width="1" class="node-destination-oasis"/>
                <circle cx="100" cy="10" r="3.5" stroke="#ffd700" stroke-width="1" class="node-destination-castle"/>
                <circle cx="140" cy="10" r="3.5" stroke="#ffd700" stroke-width="1" class="node-destination-colosseum"/>
                <circle cx="180" cy="10" r="3.5" stroke="#ffd700" stroke-width="1" class="node-destination-aerodrome"/>
                </svg>
            </div>
          </div>

          <div class="hud-panel hud-radio-card">
            <div class="hud-radio-left">
              <div class="hud-equalizer" aria-hidden="true">
                <canvas data-layer="eq" class="hud-layer-eq"></canvas>
              </div>
              <div class="hud-radio-info">
                <div class="hud-radio-sub"><span class="hud-fm-pill"><span class="radio-0">FM 88.5</span><span class="radio-1">FM 92.1</span><span class="radio-2">FM 97.3</span><span class="radio-off">FM --.-</span></span> COASTLINE RADIO</div>
                <div class="hud-radio-station"><span class="radio-0">Palm Drive</span><span class="radio-1">Tidal Breeze</span><span class="radio-2">Neon Surf</span><span class="radio-off">RADIO OFF</span></div>
                <div class="hud-radio-genre"><span class="radio-0">synth samba</span><span class="radio-1">jazz fusion</span><span class="radio-2">synthwave</span><span class="radio-off">ENGINE ONLY</span></div>
              </div>
            </div>
            <div class="hud-radio-actions">
              <button type="button" class="hud-radio-skip" id="stk-radio-skip" data-on-click="run">NEXT ›</button>
              <button type="button" class="hud-radio-skip" id="stk-radio-mute" data-on-click="run" aria-pressed="{muted}">MUTE</button>
            </div>
          </div>
        </div>
      </header>
      <div class="hud-reticles-layer">
        <div class="hud-horizon-crosshair">
          <div class="crosshair-bar"></div>
          <div class="crosshair-diamond"></div>
          <div class="crosshair-bar"></div>
        </div>
      </div>
      <footer class="hud-bottom-bar">
        <div class="hud-bottom-left">
          <div class="hud-panel hud-telemetry-card">
            <div class="hud-tel-header">
              <span class="hud-tel-title">HIGHWAY TELEMETRY</span>
              <span class="hud-livelink">LIVELINK 60 FPS</span>
            </div>
            <div class="hud-tel-rows">
              <div class="hud-tel-row">
                <span class="hud-tel-dim"><span class="hud-red-ping"></span> TRAFFIC RADAR</span>
                <span class="hud-tel-highlight"><canvas data-layer="radar" class="hud-layer" style="width: 20ch"></canvas></span>
              </div>
              <div class="hud-tel-row">
                <span class="hud-tel-dim">RIVAL SPLIT</span>
                <span class="hud-tel-cyan"><canvas data-layer="rival-split" class="hud-layer" style="width: 14ch"></canvas></span>
              </div>
              <div class="hud-tel-grid2">
                <div class="hud-grid-cell">
                  <span class="cell-label">LATERAL G-FORCE</span>
                  <span class="cell-val"><canvas data-layer="gforce" class="hud-layer" style="width: 6ch"></canvas> <span class="unit-orange">G</span></span>
                </div>
                <div class="hud-grid-cell">
                  <span class="cell-label">SLIPSTREAM GAIN</span>
                  <span class="cell-val"><canvas data-layer="slipstream" class="hud-layer" style="width: 5ch"></canvas> <span class="unit-white">KM/H</span></span>
                </div>
              </div>
              <div class="hud-draft-status-row">
                <span class="hud-draft-alert"><canvas data-layer="draft-status" class="hud-layer" style="width: 24ch"></canvas></span>
                <div class="hud-draft-meter">
                  <span class="draft-seg"></span>
                  <span class="draft-seg"></span>
                  <span class="draft-seg"></span>
                  <span class="draft-seg"></span>
                </div>
              </div>
            </div>
          </div>
          <div class="hud-util-strip">
            <button type="button" class="hud-slant hud-util-btn keys-only" id="stk-pause-btn" data-on-click="run">
              <span class="hud-slant-content">PAUSE [ESC]</span>
            </button>
          </div>
        </div>
        <div class="hud-bottom-center">
          <div class="hud-panel hud-surface-pill">
            <span>SURFACE: <strong class="text-white">DRY ASPHALT</strong></span>
            <span class="pill-dot"></span>
            <span>TRACTION: <strong class="text-emerald">100%</strong></span>
            <span class="pill-dot"></span>
            <span>WEATHER: <strong class="text-amber">SUNSET</strong></span>
          </div>
        </div>
        <div class="hud-bottom-right">
          <div class="hud-panel hud-panel-orange hud-cluster-card">
            <div class="hud-trans-header">
              <span class="hud-trans-label">TRANSMISSION</span>
              <div class="hud-gearbox-toggle">
                <canvas data-layer="gear" class="gear-tag hud-layer-gear"></canvas>
              </div>
            </div>
            <div class="hud-tacho-box">
              <div class="hud-tacho-top">
                <span>TACHOMETER</span>
                <span class="hud-rpm-val"><canvas data-layer="rpm" class="hud-layer" style="width: 12ch"></canvas></span>
              </div>
              <div class="hud-tacho-leds"><canvas data-layer="tacho" class="hud-layer-fill hud-layer-span"></canvas></div>
            </div>
            <div class="hud-velocity-row">
              <div class="hud-velo-meta">
                <span class="hud-velo-label">VELOCITY</span>
                <span class="hud-velo-mode"><canvas data-layer="velo-mode" class="hud-layer" style="width: 16ch"></canvas></span>
              </div>
              <div class="hud-velo-digits">
                <span class="hud-speed-num glow-text-orange"><canvas data-layer="speed" class="hud-layer" style="width: 3.4ch"></canvas></span>
                <span class="hud-speed-unit">KM/H</span>
              </div>
            </div>
            <div class="hud-cluster-footer">
              <span>TOP SPEED: <strong class="text-white">315 KM/H</strong></span>
              <span class="hud-nitro">
                <canvas data-layer="nitro-text" class="hud-layer" style="width: 12ch"></canvas>
                <span class="hud-nitro-bar"><canvas data-layer="nitro-bar" class="hud-layer-fill"></canvas></span>
              </span>
            </div>
          </div>
        </div>
      </footer>
    </div>
    <!-- The frame-timed moments, drawn by the presenter over the panels
         (shell/engine/effects.js). -->
    <canvas data-layer="effects" class="stk-layer stk-layer-over" aria-hidden="true"></canvas>
    <p class="stk-prompt arena-art-loading" role="status">LOADING THE ROAD AHEAD</p>

    <!-- Touch controls: DESIGN.md "Touch". -->
    <div class="touch-deck touch-only" aria-hidden="true">
      <div class="touch-seat" data-seat="1">
        <div class="touch-pad">
          <span class="touch-pad-left" data-touch-zone="drive left">◀</span>
          <span class="touch-pad-mid" data-touch-zone="drive"></span>
          <span class="touch-pad-right" data-touch-zone="drive right">▶</span>
        </div>
        <div class="touch-pedals">
          <span class="touch-nitro" data-touch-zone="nitro">NITRO</span>
          <span class="touch-brake" data-touch-zone="brake">BRAKE</span>
        </div>
      </div>
      <div class="touch-seat" data-seat="2">
        <div class="touch-pedals">
          <span class="touch-nitro" data-touch-zone="nitro-2">NITRO</span>
          <span class="touch-brake" data-touch-zone="brake-2">BRAKE</span>
        </div>
        <div class="touch-pad">
          <span class="touch-pad-left" data-touch-zone="drive-2 left-2">◀</span>
          <span class="touch-pad-mid" data-touch-zone="drive-2"></span>
          <span class="touch-pad-right" data-touch-zone="drive-2 right-2">▶</span>
        </div>
      </div>
      <span class="touch-pause" data-touch-zone="pause" data-touch-tap></span>
      <span class="touch-skip" data-touch-zone="skip" data-touch-tap>SKIP ▸▸</span>
    </div>

    <div class="stk-modal-scrim">
      <div class="stk-modal-card stk-title-card">
        <h1 class="stk-modal-title">APEX RUN</h1>
        <p class="stk-title-sub">Branching Highway Simcade</p>
        <div class="stk-title-keys stk-title-touch touch-only">
          <div><b>Left thumb</b> on the pad drives. Slide ◀ ▶ to steer, lift to coast.</div>
          <div><b>Right thumb</b>: BRAKE, and NITRO for a burst.</div>
          <div><b>❚❚</b> above the pad pauses.</div>
        </div>
        <div class="stk-title-keys keys-only">
          <div>🏎️ <b>W / ⬆️</b>: Accelerate</div>
          <div>⬅️ <b>A / D / ⬅️ ➡️</b>: Steer</div>
          <div>⚙️ <b>G</b>: Manual shift (low/high)</div>
          <div>⚡ <b>Space</b>: Nitro</div>
          <div>💨 <b>Shift / Z</b>: Drift</div>
        </div>
        <div class="stk-title-pick">PICK A STATION</div>
        <div class="stk-radio-group">
          <button type="button" class="stk-radio-btn radio-pick-0" id="stk-station-0" data-on-click="run"><span class="stk-radio-freq">FM 88.5</span><b>Palm Drive</b><span>synth samba</span></button>
          <button type="button" class="stk-radio-btn radio-pick-1" id="stk-station-1" data-on-click="run"><span class="stk-radio-freq">FM 92.1</span><b>Tidal Breeze</b><span>jazz fusion</span></button>
          <button type="button" class="stk-radio-btn radio-pick-2" id="stk-station-2" data-on-click="run"><span class="stk-radio-freq">FM 97.3</span><b>Neon Surf</b><span>synthwave</span></button>
        </div>
        <form class="stk-volume" data-entity="run" data-action="update">
          <label for="stk-volume">VOLUME</label>
          <input id="stk-volume" name="volume" type="range" min="0" max="100" data-value="{volume}">
          <span><span data-text="{volume}">70</span>%</span>
        </form>
        <div class="stk-title-actions">
          <button type="button" class="stk-btn stk-btn-go" id="stk-btn-start" data-on-click="run">START RACE<span class="keys-only"> (ENTER)</span></button>
          <button type="button" class="stk-btn" id="stk-btn-duel" data-on-click="run">DUEL · 2 PLAYERS<span class="keys-only"> (2)</span></button>
          <button type="button" class="stk-btn" id="stk-btn-pit" data-on-click="run">TELEMETRY</button>
          <div class="stk-lobby-door" data-live="lobby_tab" data-filter="id=eq.the" data-empty-row='\#(_lobbyEmpty)' \#(_lobbyReads)>
            <button type="button" class="stk-btn stk-btn-online" id="stk-btn-lobby" data-on-click="lobby">ONLINE DUEL</button>
          </div>
        </div>
      </div>
      <!-- The lobby: program.cue's `lobby`, the fold machines/lobby.js, which
           holds this tab's presence lease. Every list is a region over the
           machines' surface rows and every gesture is a row the fold writes. -->
      <div class="stk-modal-card stk-lobby-card" data-live="lobby_tab" data-filter="id=eq.the" data-empty-row='\#(_lobbyEmpty)'
           data-on-mutation="lobby" \#(_lobbyReads) data-open="{open}" data-shown="{shown}" data-pick="{stage}">
        <span hidden data-live="apexrun_presence_lease" data-filter="id=eq.{lease}" data-on-mutation="lease" data-empty=""></span>
        <h2 class="stk-modal-title">ONLINE DUEL</h2>
        <p class="stk-lobby-you">YOU RACE AS <b data-text="{name}"></b></p>
        <button type="button" class="stk-btn stk-lobby-toggle" id="btn-toggle-online" data-on-click="lobby">
          <span class="stk-lobby-when-on">ONLINE · GO OFFLINE</span><span class="stk-lobby-when-off">GO ONLINE</span>
        </button>
        <div class="stk-title-pick">THE STAGE YOU CHALLENGE ON</div>
        <div class="stk-lobby-stages" role="group" aria-label="Stage">
          \#(_duelStages)
        </div>
        <div class="stk-title-pick stk-lobby-racers-label">RACERS ONLINE</div>
        <div class="stk-lobby-racers" data-live="apexrun_presence_public" data-order="name.asc" data-project='{"me":{"eq":["id","{me}"]}}'
             \#(_lobbyReads) data-empty="No one else is online.">
          <template data-item data-when="me=eq.false">
            <div class="stk-lobby-racer"><b data-text="{name}"></b><button type="button" class="stk-btn" id="challenge-{id}" data-on-click="lobby">CHALLENGE</button></div>
          </template>
          <template data-item><i hidden></i></template>
        </div>
        <div class="stk-lobby-offers" data-live="apexrun_challenge_seat" data-filter="phase=eq.offered" data-order="id.asc" \#(_lobbyReads) data-empty="">
          <template data-item data-when="seat=eq.target">
            <div class="stk-lobby-offer"><span><b data-text="{inviter_name}"></b> CHALLENGES YOU ON <b data-text="{stage}" data-text-format="stage"></b></span>
              <button type="button" class="stk-btn stk-btn-go" id="accept-{id}" data-on-click="lobby">ACCEPT</button>
              <button type="button" class="stk-btn" id="decline-{id}" data-on-click="lobby">DECLINE</button></div>
          </template>
          <template data-item>
            <div class="stk-lobby-offer"><span>WAITING FOR <b data-text="{target_name}"></b> ON <b data-text="{stage}" data-text-format="stage"></b></span>
              <button type="button" class="stk-btn" id="cancel-{id}" data-on-click="lobby">CANCEL</button></div>
          </template>
        </div>
        <p class="stk-lobby-note" role="status" data-text="{note}"></p>
        <button type="button" class="stk-btn" id="btn-lobby-close" data-on-click="lobby">BACK</button>
      </div>
      <div class="stk-modal-card stk-pause-card">
        <h2 class="stk-modal-title">PAUSED</h2>
        <div class="stk-title-actions">
          <button type="button" class="stk-btn" id="stk-pause-resume" data-on-click="run">RESUME<span class="keys-only"> (ESC)</span></button>
          <button type="button" class="stk-btn" id="stk-pause-restart" data-on-click="run">RESTART</button>
        </div>
      </div>
      <div class="stk-modal-card stk-results-card">
        <div class="stk-res-kicker" data-text="{res_kicker}"></div>
        <h2 class="stk-modal-title stk-res-title" data-over="{res_over}" data-text="{res_title}"></h2>
        <dl class="stk-res-lines">
          <span class="stk-res-label" data-text="{line1_label}"></span><span class="stk-res-value" data-text="{line1_value}"></span>
          <span class="stk-res-label" data-text="{line2_label}"></span><span class="stk-res-value" data-text="{line2_value}"></span>
          <span class="stk-res-label" data-text="{line3_label}"></span><span class="stk-res-value" data-text="{line3_value}"></span>
          <span class="stk-res-label" data-text="{line4_label}"></span><span class="stk-res-value" data-text="{line4_value}"></span>
          <span class="stk-res-label stk-res-total">TOTAL</span><span class="stk-res-value stk-res-total" data-text="{total}"></span>
        </dl>
        <!-- An online duel's result as its machine decided it (machines/duel.cue). -->
        <p class="stk-res-verdict" role="status"><span class="verdict-pending">CONFIRMING WITH YOUR OPPONENT…</span><span class="verdict-won">RESULT RECORDED · YOU WON</span><span class="verdict-lost">RESULT RECORDED · YOU LOST</span><span class="verdict-draw">RESULT RECORDED · DRAW</span><span class="verdict-disputed">DISPUTED · THE TWO RACES DISAGREE</span><span class="verdict-abandoned">ABANDONED · NO RESULT</span></p>
        <button type="button" class="stk-btn" id="stk-res-restart" data-on-click="run">TRY AGAIN</button>
        <button type="button" class="stk-btn stk-btn-online" id="stk-res-lobby" data-on-click="run">BACK TO THE LOBBY</button>
      </div>
    </div>

    <!-- End of a run: initials into the shared table, and its top ten. -->
    <section class="arena-finish">
      <div class="arena-score">
        <p class="arena-finish-label">NEW HIGH SCORE · ENTER YOUR INITIALS</p>
        <div class="arena-keypad">
          <span class="arena-key arena-key-up touch-only" data-touch-zone="menu-up" data-touch-tap aria-hidden="true">▲</span>
          <span class="arena-key arena-key-left touch-only" data-touch-zone="menu-left" data-touch-tap aria-hidden="true">◀</span>
          <p class="arena-initials" role="group" aria-label="Initials"><span class="arena-initial" data-text="{initial_0}">A</span><span class="arena-initial" data-text="{initial_1}">A</span><span class="arena-initial" data-text="{initial_2}">A</span></p>
          <span class="arena-key arena-key-right touch-only" data-touch-zone="menu-right" data-touch-tap aria-hidden="true">▶</span>
          <span class="arena-key arena-key-down touch-only" data-touch-zone="menu-down" data-touch-tap aria-hidden="true">▼</span>
        </div>
        <p class="arena-finish-hint keys-only">Type three letters, or ▲▼ to change one and ◀▶ to move. Enter saves.</p>
        <p class="arena-finish-hint touch-only">▲▼ change the letter, ◀▶ move to the next. Then save.</p>
        <p class="invalid">Three letters, A to Z, and not a word the board refuses.</p>
        <button type="button" class="arena-finish-save" id="arena-finish-save" data-on-click="run">SAVE</button>
        <p class="arena-finish-saved">SAVED · your run is on the board.</p>
        <p class="store-error">Not saved: one score per run, and a run takes at least 75 seconds. Race again to post another.</p>
      </div>
      <h3 class="arena-finish-title">HIGH SCORES</h3>
      <ol class="arena-board" data-live="high_score" data-order="score.desc,run_ms.asc,id.asc" data-filter="limit=10" data-empty="No scores yet. Be the first."
          data-project='{"mine_score": {"eq": ["score", "{saved_score}"]}, "mine_initials": {"eq": ["initials", "{saved_initials}"]}}'>
        <template data-item>
          <li class="arena-board-row" data-mine-score="{mine_score}" data-mine-initials="{mine_initials}"><span class="arena-board-initials" data-text="{initials}"></span><span class="arena-board-outcome" data-text="{outcome}" data-text-format="ending"></span><span class="arena-board-time" data-text="{run_ms}" data-text-format="run_time"></span><span class="arena-board-score" data-text="{score}"></span></li>
        </template>
      </ol>
    </section>

    <!-- The pit lane: the race's own time-travel controls. -->
    <button type="button" class="pitlane-badge" id="pitlane-toggle" data-on-click="run" title="Telemetry">🏁 PIT-LANE TELEMETRY</button>
    <div class="pitlane-overlay">
      <div class="pitlane-header">
        <span class="pitlane-title">STK PIT-LANE TELEMETRY</span>
        <button type="button" id="pitlane-close" class="pitlane-close" data-on-click="run" aria-label="Close">✕</button>
      </div>
      <div class="pitlane-controls" data-kinetic-controls="race"></div>
    </div>
  </div>
  <!-- The run machine's fold is seated on every table it reads: a press, a
       lifted milestone and the run row itself wake it. -->
  <span hidden data-live="run_input" data-on-mutation="run" \#(_runReads) data-empty=""><template data-item><i></i></template></span>
  <span hidden data-live="run_milestone" data-on-mutation="run" \#(_runReads) data-empty=""><template data-item><i></i></template></span>
  <span hidden data-live="apexrun_duel_seat" data-on-mutation="run" \#(_runReads) data-empty=""><template data-item><i></i></template></span>
  <!-- The lobby's fold is seated on every machine row it answers, and on what
       the race sends its duel. -->
  <span hidden data-live="apexrun_duel_seat" data-on-mutation="lobby" \#(_lobbyReads) data-empty=""><template data-item><i></i></template></span>
  <span hidden data-live="apexrun_duel_command" data-on-mutation="lobby" \#(_lobbyReads) data-empty=""><template data-item><i></i></template></span>
  <span hidden data-live="run_signal" data-on-mutation="lobby" \#(_lobbyReads) data-empty=""><template data-item><i></i></template></span>
  <span hidden data-live="run_milestone" data-on-mutation="lobby" \#(_lobbyReads) data-empty=""><template data-item><i></i></template></span>
  <span hidden data-live="apexrun_presence_seat" data-on-mutation="lobby" \#(_lobbyReads) data-empty=""><template data-item><i></i></template></span>
  <span hidden data-live="apexrun_presence_command" data-on-mutation="lobby" \#(_lobbyReads) data-empty=""><template data-item><i></i></template></span>
  <span hidden data-live="apexrun_challenge_seat" data-on-mutation="lobby" \#(_lobbyReads) data-empty=""><template data-item><i></i></template></span>
  <span hidden data-live="apexrun_challenge_open" data-on-mutation="lobby" \#(_lobbyReads) data-empty=""><template data-item><i></i></template></span>
</div>
"""#

code: pronto.#App & {
	state: {
		entities: {
			// The kart game's race, racer and best-lap rows, which nothing reads or
			// writes: identity outlives them, so their fields stay retired.
			Match: {
				id: "0x915566778899aabb"
				table: "match"
				durability: "tab"
				fields: [
					{ordinal: 1, name: "id", type: "string", pk: true, cel: "this.size() <= 64"},
					{ordinal: 2, name: "track_id", type: "string", retired: true},
					{ordinal: 3, name: "status", type: "string", retired: true},
					{ordinal: 4, name: "laps_total", type: "int32", retired: true},
					{ordinal: 5, name: "current_lap", type: "int32", retired: true},
					{ordinal: 6, name: "player_position", type: "int32", retired: true},
					{ordinal: 7, name: "winner_id", type: "string", retired: true},
					{ordinal: 8, name: "time_elapsed_s", type: "int32", retired: true}
				]
			}
			Kart: {
				id: "0x9266778899aabbcc"
				table: "kart"
				durability: "tab"
				fields: [
					{ordinal: 1, name: "id", type: "string", pk: true, cel: "this.size() <= 64"},
					{ordinal: 2, name: "character", type: "string", retired: true},
					{ordinal: 3, name: "is_player", type: "string", retired: true},
					{ordinal: 4, name: "speed_kmh", type: "int32", retired: true},
					{ordinal: 5, name: "position", type: "int32", retired: true},
					{ordinal: 6, name: "current_lap", type: "int32", retired: true},
					{ordinal: 7, name: "nitro_fuel", type: "int32", retired: true},
					{ordinal: 8, name: "item", type: "string", retired: true}
				]
			}
			LapRecord: {
				id: "0x93778899aabbccdd"
				table: "lap_record"
				durability: "tab"
				fields: [
					{ordinal: 1, name: "id", type: "string", pk: true, cel: "this.size() <= 64"},
					{ordinal: 2, name: "track_id", type: "string", retired: true},
					{ordinal: 3, name: "holder_name", type: "string", retired: true},
					{ordinal: 4, name: "lap_time_ms", type: "int32", retired: true},
					{ordinal: 5, name: "tick", type: "int32", retired: true}
				]
			}
			// The run machine's row (shell/handlers/run.js): the run's phase, the
			// race it hands the kinetic child, and what the slow HUD shows.
			Run: {
				id: "0xf7aed5fa682060af"
				table: "run"
				durability: "tab"
				fields: [
					{ordinal: 1, name: "id", type: "string", pk: true, cel: "this == 'run'"},
					{ordinal: 2, name: "phase", type: "string", cel: "this in ['title', 'race', 'paused', 'ended', 'arrival', 'replay', 'result', 'initials', 'saved']"},
					{ordinal: 3, name: "seed", type: "int32"},
					{ordinal: 4, name: "race", type: "int32"},
					{ordinal: 5, name: "mode", type: "string", cel: "this in ['', 'hotseat', 'online']"},
					{ordinal: 6, name: "input", type: "string", cel: "this in ['car', 'menu']"},
					{ordinal: 7, name: "clock", type: "string", cel: "this in ['play', 'hold']"},
					{ordinal: 8, name: "lifted", type: "int32"},
					{ordinal: 9, name: "stage_id", type: "string"},
					{ordinal: 10, name: "stage_num", type: "int32"},
					{ordinal: 11, name: "next_num", type: "int32"},
					{ordinal: 12, name: "stage_name", type: "string"},
					{ordinal: 13, name: "final", type: "string"},
					{ordinal: 14, name: "fork_left", type: "string"},
					{ordinal: 15, name: "fork_right", type: "string"},
					{ordinal: 16, name: "route", type: "string"},
					{ordinal: 17, name: "racing", type: "string"},
					{ordinal: 18, name: "rival_label", type: "string"},
					{ordinal: 19, name: "res_title", type: "string"},
					{ordinal: 20, name: "res_over", type: "string"},
					{ordinal: 21, name: "res_kicker", type: "string"},
					{ordinal: 22, name: "line1_label", type: "string"},
					{ordinal: 23, name: "line1_value", type: "string"},
					{ordinal: 24, name: "line2_label", type: "string"},
					{ordinal: 25, name: "line2_value", type: "string"},
					{ordinal: 26, name: "line3_label", type: "string"},
					{ordinal: 27, name: "line3_value", type: "string"},
					{ordinal: 28, name: "line4_label", type: "string"},
					{ordinal: 29, name: "line4_value", type: "string"},
					{ordinal: 30, name: "total", type: "string"},
					{ordinal: 31, name: "outcome", type: "string"},
					{ordinal: 32, name: "score", type: "int32"},
					{ordinal: 33, name: "stage", type: "int32"},
					{ordinal: 34, name: "run_ms", type: "int32"},
					{ordinal: 35, name: "initial_0", type: "string"},
					{ordinal: 36, name: "initial_1", type: "string"},
					{ordinal: 37, name: "initial_2", type: "string"},
					{ordinal: 38, name: "cursor", type: "int32"},
					{ordinal: 39, name: "denied", type: "string"},
					{ordinal: 40, name: "saved", type: "string", cel: "this in ['no', 'yes', 'refused']"},
					{ordinal: 41, name: "saved_score", type: "int32"},
					{ordinal: 42, name: "saved_initials", type: "string"},
					{ordinal: 43, name: "station", type: "int32", cel: "this >= -1 && this <= 2"},
					{ordinal: 44, name: "muted", type: "string"},
					{ordinal: 45, name: "volume", type: "int32", cel: "this >= 0 && this <= 100"},
					{ordinal: 46, name: "pitlane", type: "string"},
					// An online duel: the last one raced, this side's seat in it, its
					// stage, the peer's session description, and the machine's verdict.
					{ordinal: 47, name: "duel", type: "string", cel: "this.size() <= 36"},
					{ordinal: 48, name: "seat", type: "int32", cel: "this >= 0 && this <= 1"},
					{ordinal: 49, name: "duel_stage", type: "string", cel: "this.size() <= 16"},
					{ordinal: 50, name: "peer", type: "string", cel: "this.size() <= 8192"},
					{ordinal: 51, name: "verdict", type: "string", cel: "this in ['', 'pending', 'won', 'lost', 'draw', 'disputed', 'abandoned']"},
					// The run's road trip the race plays back, a window a stage raced
					// (shell/handlers/run.js), while the run is in its replay.
					{ordinal: 52, name: "replay", type: "string"},
				]
			}
			// An online race's session description, keyed by its race, until the
			// lobby's fold has sent it to the duel.
			RunSignal: {
				id: "0x889dbdd918bfeda3"
				table: "run_signal"
				durability: "tab"
				fields: [
					{ordinal: 1, name: "id", type: "string", pk: true},
					{ordinal: 2, name: "description", type: "string", cel: "this.size() <= 8192"},
				]
			}
			// A press or a click, until the run machine's fold applies it.
			RunInput: {
				id: "0xdc94f27f104784e5"
				table: "run_input"
				durability: "tab"
				fields: [
					{ordinal: 1, name: "id", type: "string", pk: true},
					{ordinal: 2, name: "n", type: "int32"},
					{ordinal: 3, name: "action", type: "string"},
				]
			}
			// A milestone the race lifted at a confirmed frame (pronto's
			// kinetic-machine record): its kind and the page's detail, its
			// checksum, the commands since the last, `width` bytes a frame, and
			// for a kind the engine snapshots, the frame's state.
			RunMilestone: {
				id: "0xccb3e9083902f32b"
				table: "run_milestone"
				durability: "tab"
				fields: [
					{ordinal: 1, name: "id", type: "string", pk: true},
					{ordinal: 2, name: "race", type: "int32"},
					{ordinal: 3, name: "frame", type: "int32"},
					{ordinal: 4, name: "kind", type: "string"},
					{ordinal: 5, name: "checksum", type: "string"},
					{ordinal: 6, name: "from", type: "int32"},
					{ordinal: 7, name: "width", type: "int32"},
					{ordinal: 8, name: "inputs", type: "string"},
					{ordinal: 9, name: "detail", type: "string"},
					{ordinal: 10, name: "snapshot", type: "string"},
				]
			}
			// This tab's place in the lobby: its presence lease, drawn once, the
			// callsign it races as, who it is among the racers, the stage it
			// challenges on, and what the lobby's fold last had to say.
			LobbyTab: {
				id: "0x91c22f2244218908"
				table: "lobby_tab"
				durability: "tab"
				fields: [
					{ordinal: 1, name: "id", type: "string", pk: true, cel: "this == 'the'"},
					{ordinal: 2, name: "lease", type: "string", cel: "this.size() <= 36"},
					{ordinal: 3, name: "me", type: "string", required: false, cel: "this.size() <= 36"},
					{ordinal: 4, name: "note", type: "string", required: false, cel: "this.size() <= 64"},
					// What you last asked the switch for until the cluster answers,
					// then what it holds, so a click shows at once.
					{ordinal: 5, name: "shown", type: "string", required: false, cel: "this in ['', 'show', 'hide']"},
					{ordinal: 6, name: "open", type: "string", cel: "this in ['no', 'yes']"},
					// The challenge you last made, until the cluster answers it.
					{ordinal: 7, name: "offer", type: "string", required: false, cel: "this.size() <= 36"},
					{ordinal: 8, name: "stage", type: "string", cel: "this.size() <= 16"},
					{ordinal: 9, name: "name", type: "string", cel: "this.size() <= 16"},
				]
			}
			// The auth plane's person: every player is one, a guest the auth
			// service mints on first visit. Nobody reads another's row.
			AppUser: {
				id: "0xc3877102c61a72f3"
				table: "app_user"
				durability: "server"
				access: {scope: "internal"}
				fields: [
					// No default: the auth service supplies the id.
					{ordinal: 1, name: "id", type: "uuid", pk: true},
					{ordinal: 2, name: "handle", type: "string", unique: true, cel: "this.size() > 0"},
				]
			}
			// One shared table of finished runs. Public carries the read arm
			// alone; the insert arm, the immutability and the cadence are
			// services/database/sql/010_high_score_writes.sql (ir
			// decision-leaderboard-writes).
			HighScore: {
				id: "0x918e449216b97307"
				table: "high_score"
				durability: "live"
				access: {scope: "public"}
				fields: [
					{ordinal: 1, name: "id", type: "uuid", pk: true, default: "gen_random_uuid()"},
					{ordinal: 2, name: "player_id", type: "uuid", ref: "app_user", default: "auth_uid()"},
					{ordinal: 3, name: "initials", type: "string", cel: _initialsCel},
					// SCORE_CEILING in shell/engine/simulation.js; tests/simulation.test.ts holds the two equal.
					{ordinal: 4, name: "score", type: "int32", cel: "this >= 0 && this <= 7422146"},
					{ordinal: 5, name: "outcome", type: "string", cel: "this in ['A', 'B', 'C', 'D', 'E', 'time_over']"},
					{ordinal: 6, name: "stage", type: "int32", cel: "this >= 1 && this <= 5"},
					{ordinal: 7, name: "run_ms", type: "int32", cel: "this > 0 && this <= 255000"},
					{ordinal: 8, name: "created_at", type: "timestamp", default: "now()"},
				]
				// The clock starts at 75 s and each of the four checkpoints adds
				// 45 s: a destination is reached at stage 5 with clock left, and
				// time runs out at stage s exactly when 75 + 45(s-1) s are spent.
				invariant: cel: _runClockCel
				indexes: [{on: "score"}]
			}
		}
	}

	capabilities: auth: {required: false, service: "/auth"}

	// The arena hosts the race as a kinetic child (pronto's kinetic-machine
	// record): the terminal steps the engine on the arena's data-kinetic
	// mount, voices it and paints it, and the run machine (shell/handlers/
	// run.js) folds what it lifts and what is pressed into the run row.
	state: hybrids: {
		apexrun_presence: {machine: online.presence, rules: "machines/presence.js"}
		apexrun_challenge: {machine: online.challenge, rules: "machines/challenge.js"}
		apexrun_duel: {machine: online.duel, rules: "machines/duel.js"}
	}

	state: cortex: root: {
		config: {
			id:      "root"
			initial: "arena"
			states: arena: {meta: screen: "arena", invoke: [{src: "race"}, {src: "lobby"}]}
		}
		// The title card's lobby, which holds your presence leased while the
		// arena is open and opens the challenges you make and answer.
		setup: actors: lobby: {machine: "apexrun_presence", via: "session", handler: "machines/lobby.js"}
		setup: actors: race: {
			via:       "kinetic"
			handler:   "shell/handlers/run.js"
			engine:    "apexrun"
			sound:     "sound"
			presenter: "renderer"
			// `touch:` keys are the arena's zones (DESIGN.md "Touch").
			bindings: {
				up: ["KeyW", "ArrowUp", "gamepad:axis:1:-", "touch:drive"]
				down: ["KeyS", "ArrowDown", "gamepad:axis:1:+", "touch:brake"]
				left: ["KeyA", "ArrowLeft", "KeyH", "gamepad:axis:0:-", "touch:left"]
				right: ["KeyD", "ArrowRight", "KeyL", "gamepad:axis:0:+", "touch:right"]
				drift: ["ShiftLeft", "ShiftRight", "KeyZ", "gamepad:button:4", "gamepad:button:5"]
				nitro: ["Space", "KeyX", "gamepad:button:7", "touch:nitro"]
				enter: ["Enter", "NumpadEnter", "gamepad:button:9"]
				gear: ["KeyG", "gamepad:button:3"]
			}
			// Two players on one keyboard, WASD and the arrows, or on one touch
			// screen, the first seat's cluster on the left and the second's on
			// the right.
			seats: [
				{up: ["KeyW", "touch:drive"], down: ["KeyS", "touch:brake"], left: ["KeyA", "touch:left"], right: ["KeyD", "touch:right"], drift: ["KeyE"], nitro: ["KeyQ", "touch:nitro"]},
				{up: ["ArrowUp", "touch:drive-2"], down: ["ArrowDown", "touch:brake-2"], left: ["ArrowLeft", "touch:left-2"], right: ["ArrowRight", "touch:right-2"], drift: ["Slash"], nitro: ["ShiftRight", "touch:nitro-2"]},
			]
			// Between races: the title, the initials (▲▼ a letter, ◀▶ a slot,
			// or the letter typed) and the save; on a touch screen the keypad
			// around the letters, and SKIP over the road trip.
			menu: {
				up: ["ArrowUp", "gamepad:axis:1:-", "gamepad:button:12", "touch:menu-up"]
				down: ["ArrowDown", "gamepad:axis:1:+", "gamepad:button:13", "touch:menu-down"]
				left: ["ArrowLeft", "gamepad:axis:0:-", "gamepad:button:14", "touch:menu-left"]
				right: ["ArrowRight", "gamepad:axis:0:+", "gamepad:button:15", "touch:menu-right"]
				back: ["Backspace"]
				confirm: ["Enter", "NumpadEnter", "gamepad:button:0", "gamepad:button:9", "touch:skip"]
				duel: ["Digit2"]
				for l in strings.Split("abcdefghijklmnopqrstuvwxyz", "") {"letter_\(l)": ["Key\(strings.ToUpper(l))"]}
			}
			pause: ["Escape", "KeyP", "gamepad:button:8", "touch:pause"]
		}
	}

	state: rawMigrations: [
		{name: "010_high_score_writes.sql", src: "services/database/sql/010_high_score_writes.sql"},
	]

	capabilities: {
		blobs: true
		blobSeed: {manifest: "assets/manifest.json", origin: "https://storage.googleapis.com/trash-362115-supertuxkart-assets"}
		hatches: assets: {ir: "hatch-assets", kind: "container", note: "One-shot seed of the art pack into the blob store from its public origin, each file checked against the manifest's sha256."}
		// The renderer paints the kinetic host's frames on a canvas its seat
		// transfers, in a worker that reaches nothing but that canvas: raw
		// Babylon cannot run sealed (pronto's endowed-Babylon record), so the
		// realm holds it rather than the language. Its files are the module
		// graph it imports, and what it reads through the seat.
		vendored: renderer: {
			isolation: "agent"
			ports: {reads: [], raises: []}
			scripts: [
				"https://cdn.jsdelivr.net/npm/babylonjs@9.31.0/babylon.js",
				"https://cdn.jsdelivr.net/npm/babylonjs-loaders@9.31.0/babylonjs.loaders.min.js",
			]
			src: "shell/engine/present.js"
			files: [
				"shell/engine/present.js",
				"shell/engine/renderer.js",
				"shell/engine/hud.js",
				"shell/engine/effects.js",
				"shell/engine/art.js",
				"shell/engine/scenery.js",
				"shell/engine/scatter.js",
				"shell/engine/stage_look.js",
				"shell/engine/simulation.js",
				"shell/engine/prng.js",
				"assets/manifest.json",
			]
			note: "Babylon.js 9.31 on WebGPU, plain JavaScript in a presenter's worker that paints and raises nothing"
		}
	}

	surface: {
		screens: {
			arena: {
				title: "Arena"
				route: "/"
				// The game is the whole page: no strip to navigate it from.
				strip: false
				markup: _arenaMarkup
				forms: []
				states: ["warmup", "racing", "finished", "paused", "form-submit", "success", "validation-error"]
				files: {
					shared: []
					renderers: ["shell/renderers/ending.js", "shell/renderers/run_time.js", "shell/renderers/stage.js"]
				}
			}
		}

		// The race: the simulation, its PRNG and the stage layout it places
		// props by, a Jessie graph the terminal's cage steps on the arena's
		// kinetic child (`state.cortex`).
		engines: apexrun: {
			src:  "shell/engine/engine.js"
			note: "the 60Hz deterministic simulation, Jessie endowed with nothing"
		}
		// The race's sound: engine, wind, tyres, cues and the radio, a Jessie
		// role whose one authority is the tamed AudioContext it is handed.
		engines: sound: {
			src:  "shell/engine/sound.js"
			role: "sound"
			note: "the live-synthesized mix, Jessie on the AudioContext the terminal tames"
		}

		design: (pronto.#DesignMd & {text: _designMd}).design

		flows: {
			"create-high-score": {of: "arena", entity: "HighScore", action: "create"}
		}
	}

	meta: {
		name: "apexrun"
		description: "Apex Run kinetic arcade racing in Pronto"
		ir: {sha256: "304246d00ac094ec31baa817b556b52f102c2d8ff87c2ed1656aedf6c62c8fd8"}
		targets: ["cloudflare"]
		domain: "apexrun.bonisoft3.com"
		decisions: {
			"decision-01": {}
			"decision-02": {}
			"decision-03": {}
			"decision-leaderboard-writes": {}
			"decision-escape-hatches": {}
		}
		tests: {
			"test-instant-arena": {
				of: "arena"
				says: "Opening the arena lands on the title card over the first stage, with the car on the road and the controls shown."
				given: {}
				when: "mount screen"
				then: "output.ready"
			}
			"test-speedometer": {
				of: "arena"
				says: "Speedometer, stage, and nitro display racing telemetry."
				given: {speed: 120}
				when: "accelerate"
				then: "output.speed == 120"
			}
			"test-high-score": {
				of: "arena"
				says: "A run that ranks in the shared top ten takes three initials, and the saved row shows live on another player's board with its ending, time and score."
				given: {score: 7000000}
				when: "run ends, initials ACE, Enter"
				then: "output.board.mine.initials == 'ACE'"
			}
			"test-score-refused": {
				of: "arena"
				says: "A save the table refuses, and initials it denies, are said on the form instead of closing it."
				given: {saved_within_s: 75}
				when: "run ends, initials, Enter"
				then: "output.form.store_error.visible"
			}
		}
	}
}

// The journal's images ship with it: every one its pages reference, read from
// the journal itself, so a new entry's shots cannot be left behind.
_journal: _ @embed(file="journal.html", type=text)
_journalAssets: {for m in regexp.FindAllSubmatch(#"src="(journal_assets/[^"]+)""#, _journal, -1) {(m[1]): true}}

_extraApexrunStatics: [
	for f in list.Concat([[
		"journal.html",
		"ir.html",
		"ir/card.css",
		"ir/neighbourhood-app.svg",
		"ir/neighbourhood-arena.svg",
		"brief.html",
		"brief.md",
	], [for f, _ in _journalAssets {f}]]) {
		file:   f
		target: "/srv/\(f)"
		watch:  true
	},
]

cluster: (pronto.#DefaultCluster & {
	"code":  code
	statics: list.Concat([terminal.surface.statics, _extraApexrunStatics])
}).out
terminal: surface: renderers: ["shell/renderers/ending.js", "shell/renderers/run_time.js", "shell/renderers/stage.js"]

terminal: (pronto.#DefaultTerminal & {"code": code}).out
loop: (pronto.#DefaultLoop & {"code": code, "cluster": cluster, "terminal": terminal}).out

loop: surface: checks: "simulation": {
	verb: "test"
	cmds: [
		"deno test --config tests/deno.json --lock tests/deno.lock --frozen --unstable-raw-imports --allow-read --allow-env tests/simulation.test.ts tests/kinetic_engine.test.ts tests/sync.test.ts tests/milestones.test.ts",
	]
	note: "the deterministic 60Hz highway step (drifting, nitro, traffic, forks, the clock), the rollback host's save, load, replay and rewind, its sync test over recorded runs, and the milestones a run lifts and loads back to"
}

// The art pack: generated and CC0 files live in a public bucket, named by
// their sha256 in assets/manifest.json; each launch copies them into the blob
// store, which the game reads at /blobs/mecha-objects/<file>.
cluster: surface: targets: {
	assets: {
		visibility: "internal"
		activate:   ""
		cmd: "builtin": null
		srcs: globs: ["services/assets/seed.ts", "assets/manifest.json"]
		dockerfile: {
			from: name: "denoland/deno:debian-2.9.7@sha256:fa335acdf6b72106eda2cb6a8cb5f4187e7630e357467489db4b2e7352d5e432"
			workdir: "/app"
			copy: [{srcs: ["services/assets/seed.ts", "assets/manifest.json"], dst: "/app/"}]
			epilogue: ["RUN deno cache seed.ts"]
			cmd: ["run", "--cached-only", "--allow-read=/app", "--allow-env", "--allow-net=storage.googleapis.com,rclone-s3:3900", "seed.ts"]
		}
		compose: {
			depends_on: "rclone-s3": {condition: "service_healthy"}
			environment: {
				ASSET_MANIFEST: "/app/manifest.json"
				ASSET_ORIGIN:   code.capabilities.blobSeed.origin
				BLOB_STORE:     "http://rclone-s3:3900/mecha-objects"
			}
			restart: "no"
		}
	}
	launch: compose: depends_on: assets: {condition: "service_completed_successfully"}
}

loop: surface: checks: "assets": {
	verb: "test"
	cmds: [
		"deno test --config tests/deno.json --lock tests/deno.lock --frozen --unstable-raw-imports --allow-read tests/assets.test.ts tests/art.test.ts",
	]
	note: "the art pack: the seed refuses tampered bytes, and every stage maps to files the manifest has"
}

loop: surface: checks: "scenery": {
	verb: "test"
	cmds: [
		"deno test --config tests/deno.json --lock tests/deno.lock --frozen --unstable-raw-imports --allow-read --allow-env tests/scenery.test.ts tests/scatter.test.ts",
	]
	note: "the generated scenery: noise, ridge shapes per stage, frond cut-outs, wave normals, ground detail, verge scatter"
}

loop: surface: checks: "renderer": {
	verb: "test"
	cmds: [
		"deno test --config tests/deno.json --lock tests/deno.lock --frozen --unstable-raw-imports --allow-read --allow-env tests/renderer.test.ts",
	]
	note: "adaptive resolution scaling, hardware scaling levels, and Babylon.js 3D rendering pipeline"
}

loop: surface: checks: "run": {
	verb: "test"
	cmds: [
		"deno test --config tests/deno.json --lock tests/deno.lock --frozen --unstable-raw-imports --allow-read --allow-env tests/run.test.ts",
	]
	note: "the run machine: its phases from the title to the saved score, the race's milestones as its rows, the initials a key, a gamepad and the touch keypad edit while nothing reaches the car, and the pad and pedals as the car's and each duel seat's bits"
}

loop: surface: checks: "online_machine": {
	verb: "test"
	cmds: [
		"deno test --config tests/deno.json --lock tests/deno.lock --frozen --unstable-raw-imports --allow-read --allow-env tests/online-machine.test.ts tests/lobby.test.ts",
	]
	note: "the lobby's presence and challenges and the duel machine through their rules: admissions, answers, deadlines, the desync dispute and the result; the lobby's fold over its rows"
}

loop: surface: checks: "audio": {
	verb: "test"
	cmds: [
		"deno test --config tests/deno.json --lock tests/deno.lock --frozen --unstable-raw-imports --allow-read --allow-env tests/audio.test.ts",
	]
	note: "station sequencer, engine voice and the WebAudio mix built against a recording context, in the terminal's cage"
}

build: (pronto.#DefaultBuild & {"code": code, "loop": loop, "cluster": cluster, "terminal": terminal}).out

build: checks: "finish": {
	browser:  true
	database: true
	cmds: ["deno run --config tests/deno.json --lock tests/deno.lock --frozen --unstable-raw-imports --allow-read --allow-write --allow-net --allow-env --allow-run --allow-sys --unsafely-ignore-certificate-errors=caddy tests/finish.ts ."]
	note: "end of a run in the browser: a goal plays its set piece and Enter skips its road trip, run-ended fills the form, the save reaches a second player's live board, a refused save and denied initials are said on the form"
}

out: pronto.#emit & {"code": code, "cluster": cluster, "terminal": terminal, "loop": loop, "build": build}

build: checks: "boot": {
	browser: true
	cmds: ["deno run --config tests/deno.json --lock tests/deno.lock --frozen --unstable-raw-imports --allow-read --allow-write --allow-net --allow-env --allow-run --allow-sys --unsafely-ignore-certificate-errors=caddy tests/boot.ts ."]
	note: "the game boots in the browser: the engine module loads, the scene builds and draws frames, no page error"
}

build: checks: "online": {
	database: true
	cmds: ["deno test --config tests/deno.json --lock tests/deno.lock --frozen --unstable-raw-imports --allow-env --allow-net --allow-read tests/online-access.ts"]
	note: "the lobby and the duel through their surface rows in the stack's Postgres: leases, challenge races and expiry, the duel's signalling, joined milestones, the desync dispute, the result and the disconnect timeout"
}

build: checks: "duel": {
	browser:  true
	database: true
	cmds: ["deno run --config tests/deno.json --lock tests/deno.lock --frozen --unstable-raw-imports --allow-read --allow-write --allow-net --allow-env --allow-run --allow-sys --unsafely-ignore-certificate-errors=caddy tests/duel.ts ."]
	note: "two racers in the lobby, a challenge accepted, the duel raced over a real data channel the duel machine signalled, to an end card both read from its result, with the same milestones and checksums"
}

build: checks: "touch": {
	browser:  true
	database: true
	cmds: ["deno run --config tests/deno.json --lock tests/deno.lock --frozen --unstable-raw-imports --allow-read --allow-write --allow-net --allow-env --allow-run --allow-sys --unsafely-ignore-certificate-errors=caddy tests/touch.ts ."]
	note: "Apex Run by touch alone on an emulated phone held flat and upright and a tablet: a run driven on the pad and pedals, paused and resumed, ended, its initials edited on the keypad and saved to the board; a duel on one tablet, each seat on its own cluster; a desktop shows none of it"
}

build: checks: "leaderboard-access": {
	database: true
	cmds: ["deno test --config tests/deno.json --lock tests/deno.lock --frozen --unstable-raw-imports --allow-env --allow-net --allow-read --unsafely-ignore-certificate-errors=caddy tests/leaderboard-access.ts"]
	note: "high scores: a player inserts only their own, once per run, never edits; checks refuse what no run produces; a redelivered POST is one row"
}
