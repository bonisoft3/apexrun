//! `apexrun-desktop-host`: Native Desktop Host integrating:
//!   - `omnishell-winio` (AppKit / WinUI 3 / GTK 4 / Qt 6 slow HUD & accessibility tree)
//!   - `omnishell-bevy-presenter` (Bevy `wgpu` Metal/DX12/Vulkan 3D stage + orthographic Fast HUD)
//!   - `omnishell-audio` (CoreAudio / CPAL native `SoundEngine` + `AudioContext` role bridge)
//!   - `GgrsDuelSession` (native GGRS P2P rollback duel compatible with the Web peer input stream)

pub mod art_scene;

use crate::art_scene::TOON_WGSL;
use omnishell_audio::NativeSoundEngine;
use omnishell_bevy_presenter::{BevyKineticPresenter, FrameStats, PoseBuffer};
use omnishell_winio::{
    parse_winio_screen_spec, DesktopMessage, NativeBackend, WinioDesktopApp, WinioScreenSpec,
};
use std::collections::BTreeMap;

pub const ARENA_WINIO_JSON: &str = include_str!("../fixtures/arena_winio.json");
pub const COCONUT_BEACH_GLB: &[u8] = include_bytes!("../fixtures/coconut_beach.glb");

/// Compact per-seat input frame matching `kinetic.js` / `apexrunEngine` input bits.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct DuelInput {
    pub up: bool,
    pub down: bool,
    pub left: bool,
    pub right: bool,
    pub shift: bool,
}

impl DuelInput {
    pub fn to_bitmask(self) -> u8 {
        (if self.up { 1 } else { 0 })
            | (if self.down { 2 } else { 0 })
            | (if self.left { 4 } else { 0 })
            | (if self.right { 8 } else { 0 })
            | (if self.shift { 16 } else { 0 })
    }

    pub fn from_bitmask(mask: u8) -> Self {
        Self {
            up: (mask & 1) != 0,
            down: (mask & 2) != 0,
            left: (mask & 4) != 0,
            right: (mask & 8) != 0,
            shift: (mask & 16) != 0,
        }
    }
}

/// Deterministic fixed-point / quantization-safe per-seat physics snapshot for GGRS rollback.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SeatSimState {
    pub z_mm: i64,
    pub x_mm: i64,
    pub speed_cms: i64,
    pub rpm: i64,
    pub gear: u8,
    pub nitro_milli: i64,
    pub finished_tick: u32,
}

impl Default for SeatSimState {
    fn default() -> Self {
        Self {
            z_mm: 0,
            x_mm: 0,
            speed_cms: 0,
            rpm: 900,
            gear: 1,
            nitro_milli: 100_000,
            finished_tick: 0,
        }
    }
}

/// Complete deterministic 2-seat duel state snapshot saved/restored by GGRS rollback.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DuelWorldState {
    pub tick: u32,
    pub goal_z_mm: i64,
    pub seats: [SeatSimState; 2],
    pub winner: u8,
}

impl DuelWorldState {
    pub fn new(goal_z_mm: i64) -> Self {
        Self {
            tick: 0,
            goal_z_mm,
            seats: [SeatSimState::default(), SeatSimState::default()],
            winner: 0,
        }
    }

    /// Deterministic FNV-1a 64-bit checksum for GGRS desync detection across Desktop, Mobile, and Web peers.
    pub fn checksum(&self) -> u64 {
        let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
        let mut mix = |bytes: &[u8]| {
            for &b in bytes {
                hash ^= b as u64;
                hash = hash.wrapping_mul(0x0100_0000_01b3);
            }
        };
        mix(&self.tick.to_le_bytes());
        mix(&self.goal_z_mm.to_le_bytes());
        mix(&[self.winner]);
        for s in &self.seats {
            mix(&s.z_mm.to_le_bytes());
            mix(&s.x_mm.to_le_bytes());
            mix(&s.speed_cms.to_le_bytes());
            mix(&s.rpm.to_le_bytes());
            mix(&[s.gear]);
            mix(&s.nitro_milli.to_le_bytes());
            mix(&s.finished_tick.to_le_bytes());
        }
        hash
    }

    /// Advance one 60 Hz deterministic simulation tick for both seats.
    pub fn advance_frame(&mut self, inputs: [DuelInput; 2]) {
        self.tick += 1;
        for (idx, inp) in inputs.iter().enumerate() {
            let s = &mut self.seats[idx];
            let accel_cms = if inp.up {
                if inp.shift && s.nitro_milli > 0 {
                    s.nitro_milli = (s.nitro_milli - 850).max(0);
                    185
                } else {
                    125
                }
            } else if inp.down {
                -240
            } else {
                -45
            };
            let max_speed_cms = if inp.shift && s.nitro_milli > 0 {
                32_500
            } else {
                29_500
            };
            s.speed_cms = (s.speed_cms + accel_cms).clamp(0, max_speed_cms);

            let steer_mm = if inp.left && !inp.right {
                -120
            } else if inp.right && !inp.left {
                120
            } else {
                0
            };
            s.x_mm = (s.x_mm + steer_mm).clamp(-9_000, 9_000);
            // Distance advanced in mm at 60 Hz: speed_cms * 10 / 60 = speed_cms / 6
            s.z_mm += s.speed_cms / 6;
            s.gear = if s.speed_cms > 14_500 { 2 } else { 1 };
            s.rpm = 900 + (s.speed_cms * 7_300) / 29_500;

            if s.z_mm >= self.goal_z_mm && s.finished_tick == 0 {
                s.finished_tick = self.tick;
                if self.winner == 0 {
                    self.winner = (idx + 1) as u8;
                }
            }
        }
    }

    /// Project the current deterministic state into the 186-float `PoseBuffer` for `BevyKineticPresenter`.
    pub fn to_pose_buffer(&self, eq_bands: [f32; 6]) -> PoseBuffer {
        let mut pose = PoseBuffer::default();
        let hero = &self.seats[0];
        let rival = &self.seats[1];
        let hero_z = hero.z_mm as f32 / 1000.0;
        let hero_x = hero.x_mm as f32 / 1000.0;
        let speed_kmh = (hero.speed_cms as f32 / 100.0).round();

        pose.floats[0] = self.tick as f32;
        pose.floats[1] = 1.0;
        pose.floats[2] = self.tick as f32 / 60.0;
        pose.floats[3] = 1.0;
        // Camera eye behind hero
        pose.floats[4] = hero_x * 0.65;
        pose.floats[5] = 2.15;
        pose.floats[6] = hero_z - 6.8;
        // Camera target ahead of hero
        pose.floats[7] = hero_x;
        pose.floats[8] = 1.1;
        pose.floats[9] = hero_z + 24.0;
        pose.floats[10] = 0.92;
        pose.floats[12] = 0.012;
        // Hero pose
        pose.floats[20] = hero_x;
        pose.floats[21] = 0.0;
        pose.floats[22] = hero_z;
        pose.floats[28] = 0.32;
        // Fast HUD scalars
        pose.floats[68] = speed_kmh;
        pose.floats[69] = hero.rpm as f32;
        pose.floats[70] = ((hero.rpm - 800) as f32 / 7700.0).clamp(0.0, 1.0);
        pose.floats[71] = hero.gear as f32;
        pose.floats[72] = (hero.nitro_milli as f32 / 1000.0).clamp(0.0, 100.0);
        pose.floats[74] = (60u32.saturating_sub(self.tick / 60)) as f32;
        pose.floats[76] = (hero.z_mm / 10) as f32;
        for (i, &b) in eq_bands.iter().enumerate() {
            pose.floats[84 + i] = b;
        }
        // Seat 2 (rival) encoded in traffic slot 0
        pose.floats[90] = 1.0;
        pose.floats[91] = rival.x_mm as f32 / 1000.0;
        pose.floats[92] = 0.0;
        pose.floats[93] = rival.z_mm as f32 / 1000.0;
        pose
    }
}

/// Native GGRS P2P rollback session manager.
pub struct GgrsDuelSession {
    pub state: DuelWorldState,
    pub saved_states: BTreeMap<u32, (DuelWorldState, u64)>,
    pub confirmed_inputs: BTreeMap<u32, [DuelInput; 2]>,
    pub predicted_inputs: BTreeMap<u32, [DuelInput; 2]>,
    pub rollback_count: usize,
}

impl GgrsDuelSession {
    pub fn new(goal_z_mm: i64) -> Self {
        let state = DuelWorldState::new(goal_z_mm);
        let mut saved_states = BTreeMap::new();
        saved_states.insert(0, (state.clone(), state.checksum()));
        Self {
            state,
            saved_states,
            confirmed_inputs: BTreeMap::new(),
            predicted_inputs: BTreeMap::new(),
            rollback_count: 0,
        }
    }

    pub fn save_state(&mut self) -> u64 {
        let csum = self.state.checksum();
        self.saved_states
            .insert(self.state.tick, (self.state.clone(), csum));
        csum
    }

    pub fn load_state(&mut self, tick: u32) -> Result<(), String> {
        let (snap, _) = self
            .saved_states
            .get(&tick)
            .ok_or_else(|| format!("Missing saved state for tick {}", tick))?;
        self.state = snap.clone();
        Ok(())
    }

    /// Step one frame with local + (possibly predicted) remote input.
    pub fn step_frame(&mut self, local_seat: usize, local: DuelInput, remote_predicted: DuelInput) {
        let next_tick = self.state.tick + 1;
        let pair = if local_seat == 0 {
            [local, remote_predicted]
        } else {
            [remote_predicted, local]
        };
        self.predicted_inputs.insert(next_tick, pair);
        self.state.advance_frame(pair);
        self.save_state();
    }

    /// Receive an authoritative remote input for a past `tick`; if it differs from the
    /// prediction, roll back to `tick - 1` and resimulate forward to `current_tick`.
    pub fn receive_remote_input(
        &mut self,
        remote_seat: usize,
        tick: u32,
        actual_remote: DuelInput,
    ) -> Result<bool, String> {
        let current_tick = self.state.tick;
        let Some(&predicted_pair) = self.predicted_inputs.get(&tick) else {
            return Ok(false);
        };
        let mut updated_pair = predicted_pair;
        updated_pair[remote_seat] = actual_remote;
        self.confirmed_inputs.insert(tick, updated_pair);

        if predicted_pair[remote_seat] == actual_remote {
            return Ok(false);
        }

        // Prediction mismatch: roll back to `tick - 1` and resimulate through `current_tick`
        self.rollback_count += 1;
        self.predicted_inputs.insert(tick, updated_pair);
        self.load_state(tick - 1)?;
        for t in tick..=current_tick {
            let mut pair = *self
                .predicted_inputs
                .get(&t)
                .ok_or_else(|| format!("Missing input at tick {}", t))?;
            // Carry forward the latest confirmed remote input for subsequent unconfirmed frames
            if t > tick && !self.confirmed_inputs.contains_key(&t) {
                pair[remote_seat] = actual_remote;
                self.predicted_inputs.insert(t, pair);
            }
            self.state.advance_frame(pair);
            self.save_state();
        }
        Ok(true)
    }
}

/// Integrated Desktop Host combining `winio`, `BevyKineticPresenter`, `NativeSoundEngine`, and `GgrsDuelSession`.
pub struct OmnishellDesktopHost {
    pub winio: WinioDesktopApp,
    pub presenter: BevyKineticPresenter,
    pub audio: NativeSoundEngine,
    pub duel: GgrsDuelSession,
}

impl OmnishellDesktopHost {
    pub fn boot_apexrun(backend: NativeBackend) -> Result<Self, String> {
        let arena_spec: WinioScreenSpec = parse_winio_screen_spec(ARENA_WINIO_JSON)?;
        let winio = WinioDesktopApp::init(backend, vec![arena_spec], "arena");
        let (_, handle) = winio
            .active_kinetic_surface()
            .ok_or_else(|| "arena screen missing KineticSurface".to_string())?;
        let mut presenter = BevyKineticPresenter::new(handle);
        presenter.set_custom_shader(TOON_WGSL);
        presenter.load_stage_glb(COCONUT_BEACH_GLB)?;
        let audio = NativeSoundEngine::new(48_000);
        let duel = GgrsDuelSession::new(150_000); // 150 m sprint goal
        Ok(Self {
            winio,
            presenter,
            audio,
            duel,
        })
    }

    /// Execute one synchronized 120 Hz desktop frame: step simulation, update audio + EQ,
    /// render 3D stage + orthographic Fast HUD, and update slow HUD scalar bindings.
    pub fn tick_frame(&mut self, seat0: DuelInput, seat1: DuelInput) -> FrameStats {
        self.duel.step_frame(0, seat0, seat1);
        let hero = &self.duel.state.seats[0];
        let speed_kmh = hero.speed_cms as f32 / 100.0;
        let is_drifting = (seat0.left || seat0.right) && speed_kmh > 120.0;
        let is_nitro = seat0.shift && hero.nitro_milli > 0;
        let off_road = hero.x_mm.abs() > 7_500;
        let curb = if hero.x_mm.abs() > 6_500 { 0.8 } else { 0.0 };

        self.audio.update_engine(
            speed_kmh,
            is_drifting,
            is_nitro,
            hero.rpm as f32,
            off_road,
            curb,
        );
        let eq_vec = self.audio.levels(6);
        let mut eq_bands = [0.0f32; 6];
        for (i, &v) in eq_vec.iter().take(6).enumerate() {
            eq_bands[i] = v;
        }

        let pose = self.duel.state.to_pose_buffer(eq_bands);
        let stats = self.presenter.render_frame(&pose);

        self.winio.update(DesktopMessage::UpdateScalar {
            name: "speed".to_string(),
            value: stats.fast_hud.speed_text.clone(),
        });
        self.winio.update(DesktopMessage::UpdateScalar {
            name: "gear".to_string(),
            value: stats.fast_hud.gear_text.clone(),
        });
        stats
    }
}

pub mod macos_ffi {
    use super::*;
    use crate::art_scene::{
        apex_art_atlas_rgba, build_dynamic_frame_geometry, build_static_stage_geometry,
        manifest_file_cstr, partition_indices_into_z_chunks, StaticChunkC,
    };
    use omnishell_bevy_presenter::{GpuVertex, POSE_BUFFER_FLOATS};
    use std::ffi::{c_char, CStr};
    use std::sync::{Mutex, OnceLock};

    pub const APEXRUN_SIM_BUNDLE_JS: &str = include_str!("../fixtures/apexrun_sim_bundle.js");

    pub const RADIO_STATIONS: [(&str, &str, &str); 3] = [
        ("88.5", "Palm Drive", "magical_sound_shower"),
        ("92.1", "Tidal Breeze", "passing_breeze"),
        ("97.3", "Neon Surf", "splash_wave"),
    ];

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct MacHudSnapshotC {
        pub show_title_card: u32,
        pub show_pause_card: u32,
        pub show_result_card: u32,
        pub is_paused: u32,
        pub is_muted: u32,
        pub gear: u32,
        pub nitro_state: u32,
        pub nitro_charges: u32,
        pub pyramid_node_index: u32,
        pub nitro_ratio: f32,
        pub tacho_ratio: f32,
        pub route_progress: f32,
        pub rival_fill: f32,
        pub volume: f32,
        pub eq_bands: [f32; 6],
        pub stage_label: [u8; 64],
        pub checkpoint_code: [u8; 32],
        pub score_label: [u8; 32],
        pub timer_label: [u8; 32],
        pub speed_label: [u8; 32],
        pub rpm_label: [u8; 32],
        pub nitro_label: [u8; 32],
        pub velo_mode_label: [u8; 32],
        pub drift_label: [u8; 64],
        pub matrix_fork_label: [u8; 64],
        pub branch_left_label: [u8; 64],
        pub branch_right_label: [u8; 64],
        pub rival_header_label: [u8; 32],
        pub rival_gap_label: [u8; 32],
        pub radar_label: [u8; 32],
        pub gforce_label: [u8; 32],
        pub slipstream_label: [u8; 32],
        pub station_label: [u8; 64],
        pub rival_label: [u8; 64],
        pub telemetry_label: [u8; 96],
        pub banner_label: [u8; 64],
        pub result_summary: [u8; 128],
    }

    impl Default for MacHudSnapshotC {
        fn default() -> Self {
            Self {
                show_title_card: 1,
                show_pause_card: 0,
                show_result_card: 0,
                is_paused: 0,
                is_muted: 0,
                gear: 1,
                nitro_state: 0,
                nitro_charges: 3,
                pyramid_node_index: 0,
                nitro_ratio: 1.0,
                tacho_ratio: 0.1,
                route_progress: 0.0,
                rival_fill: 0.25,
                volume: 0.8,
                eq_bands: [0.0; 6],
                stage_label: [0; 64],
                checkpoint_code: [0; 32],
                score_label: [0; 32],
                timer_label: [0; 32],
                speed_label: [0; 32],
                rpm_label: [0; 32],
                nitro_label: [0; 32],
                velo_mode_label: [0; 32],
                drift_label: [0; 64],
                matrix_fork_label: [0; 64],
                branch_left_label: [0; 64],
                branch_right_label: [0; 64],
                rival_header_label: [0; 32],
                rival_gap_label: [0; 32],
                radar_label: [0; 32],
                gforce_label: [0; 32],
                slipstream_label: [0; 32],
                station_label: [0; 64],
                rival_label: [0; 64],
                telemetry_label: [0; 96],
                banner_label: [0; 64],
                result_summary: [0; 128],
            }
        }
    }

    fn write_cstr_buf<const N: usize>(buf: &mut [u8; N], text: &str) {
        buf.fill(0);
        let mut copy_len = text.len().min(N.saturating_sub(1));
        while copy_len > 0 && !text.is_char_boundary(copy_len) {
            copy_len -= 1;
        }
        buf[..copy_len].copy_from_slice(&text.as_bytes()[..copy_len]);
    }

    struct MacAppState {
        host: OmnishellDesktopHost,
        static_vertices: Vec<GpuVertex>,
        static_indices: Vec<u32>,
        static_chunks: Vec<StaticChunkC>,
        dynamic_vertices: Vec<GpuVertex>,
        dynamic_indices: Vec<u32>,
        station_index: usize,
        saved_volume: f32,
        last_countdown_code: i32,
        last_nitro_active: bool,
        checkpoint_banner_ticks: u32,
    }

    static APP_STATE: OnceLock<Mutex<MacAppState>> = OnceLock::new();
    static AUDIO_ENGINE: OnceLock<Mutex<NativeSoundEngine>> = OnceLock::new();

    #[cfg(any(target_os = "macos", target_os = "ios"))]
    extern "C" {
        fn apexrun_macos_run_app();
    }

    pub fn run_macos_app() {
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        unsafe {
            apexrun_macos_run_app();
        }
        #[cfg(not(any(target_os = "macos", target_os = "ios")))]
        {
            eprintln!("apexrun-mac requires macOS or iOS (AppKit/UIKit + Metal + AudioToolbox + JavaScriptCore).");
        }
    }

    /// # Safety
    /// Caller must pass valid or null pointers for `sim_js_ptr` and `sim_js_len`.
    #[no_mangle]
    pub unsafe extern "C" fn apexrun_rust_init(
        sim_js_ptr: *mut *const c_char,
        sim_js_len: *mut usize,
    ) -> bool {
        let Ok(host) = OmnishellDesktopHost::boot_apexrun(NativeBackend::AppKit) else {
            return false;
        };
        let Ok((static_vertices, mut static_indices)) =
            build_static_stage_geometry(COCONUT_BEACH_GLB)
        else {
            return false;
        };
        let static_chunks =
            partition_indices_into_z_chunks(&static_vertices, &mut static_indices);

        let mut audio = NativeSoundEngine::new(48_000);
        audio.start_music(RADIO_STATIONS[0].2);
        let _ = AUDIO_ENGINE.set(Mutex::new(audio));

        let state = MacAppState {
            host,
            static_vertices,
            static_indices,
            static_chunks,
            dynamic_vertices: Vec::new(),
            dynamic_indices: Vec::new(),
            station_index: 0,
            saved_volume: 0.8,
            last_countdown_code: 0,
            last_nitro_active: false,
            checkpoint_banner_ticks: 0,
        };
        let _ = APP_STATE.set(Mutex::new(state));

        unsafe {
            if !sim_js_ptr.is_null() {
                *sim_js_ptr = APEXRUN_SIM_BUNDLE_JS.as_ptr() as *const c_char;
            }
            if !sim_js_len.is_null() {
                *sim_js_len = APEXRUN_SIM_BUNDLE_JS.len();
            }
        }
        true
    }

    /// # Safety
    /// Caller must pass valid or null pointers for `json_ptr` and `json_len`.
    #[no_mangle]
    pub unsafe extern "C" fn apexrun_rust_get_winio_spec_json(
        json_ptr: *mut *const c_char,
        json_len: *mut usize,
    ) {
        unsafe {
            if !json_ptr.is_null() {
                *json_ptr = ARENA_WINIO_JSON.as_ptr() as *const c_char;
            }
            if !json_len.is_null() {
                *json_len = ARENA_WINIO_JSON.len();
            }
        }
    }

    /// # Safety
    /// Caller must pass valid or null out-pointers.
    #[no_mangle]
    pub unsafe extern "C" fn apexrun_rust_get_static_mesh(
        verts_out: *mut *const GpuVertex,
        vert_count_out: *mut usize,
        indices_out: *mut *const u32,
        index_count_out: *mut usize,
    ) {
        let Some(lock) = APP_STATE.get() else {
            return;
        };
        let st = lock.lock().unwrap();
        unsafe {
            if !verts_out.is_null() {
                *verts_out = st.static_vertices.as_ptr();
            }
            if !vert_count_out.is_null() {
                *vert_count_out = st.static_vertices.len();
            }
            if !indices_out.is_null() {
                *indices_out = st.static_indices.as_ptr();
            }
            if !index_count_out.is_null() {
                *index_count_out = st.static_indices.len();
            }
        }
    }

    /// # Safety
    /// Caller must pass valid or null out-pointers.
    #[no_mangle]
    pub unsafe extern "C" fn apexrun_rust_get_static_chunks(
        chunks_out: *mut *const StaticChunkC,
        chunk_count_out: *mut usize,
    ) {
        let Some(lock) = APP_STATE.get() else {
            return;
        };
        let st = lock.lock().unwrap();
        unsafe {
            if !chunks_out.is_null() {
                *chunks_out = st.static_chunks.as_ptr();
            }
            if !chunk_count_out.is_null() {
                *chunk_count_out = st.static_chunks.len();
            }
        }
    }

    /// # Safety
    /// Caller must pass a valid buffer of `glb_len` bytes when `glb_bytes` is non-null.
    #[no_mangle]
    pub unsafe extern "C" fn apexrun_rust_load_stage_glb(
        glb_bytes: *const u8,
        glb_len: usize,
    ) -> bool {
        if glb_bytes.is_null() || glb_len < 20 {
            return false;
        }
        let slice = unsafe { std::slice::from_raw_parts(glb_bytes, glb_len) };
        let Ok((verts, mut inds)) = build_static_stage_geometry(slice) else {
            return false;
        };
        let chunks = partition_indices_into_z_chunks(&verts, &mut inds);
        let Some(lock) = APP_STATE.get() else {
            return false;
        };
        let mut st = lock.lock().unwrap();
        if st.host.presenter.load_stage_glb(slice).is_err() {
            return false;
        }
        st.static_vertices = verts;
        st.static_indices = inds;
        st.static_chunks = chunks;
        true
    }

    /// # Safety
    /// Caller must pass a valid NUL-terminated C string when `action_cstr` is non-null.
    #[no_mangle]
    pub unsafe extern "C" fn apexrun_rust_on_action(action_cstr: *const c_char, float_arg: f32) {
        if action_cstr.is_null() {
            return;
        }
        let action = unsafe { CStr::from_ptr(action_cstr) }
            .to_string_lossy()
            .to_string();

        let Some(lock) = APP_STATE.get() else {
            return;
        };
        let mut st = lock.lock().unwrap();
        let mut audio_guard = AUDIO_ENGINE.get().map(|m| m.lock().unwrap());

        match action.as_str() {
            "start-game" | "start-duel" => {
                st.host.winio.update(DesktopMessage::SetStateAttr {
                    key: "phase".to_string(),
                    value: "racing".to_string(),
                });
                if let Some(a) = audio_guard.as_mut() {
                    a.trigger_cue("countdown");
                    if !a.music_playing {
                        a.start_music(RADIO_STATIONS[st.station_index].2);
                    }
                }
            }
            "toggle-pause" => {
                let phase = st
                    .host
                    .winio
                    .state_attrs
                    .get("phase")
                    .map(|s| s.as_str())
                    .unwrap_or("title");
                let next_phase = if phase == "racing" {
                    Some("paused")
                } else if phase == "paused" {
                    Some("racing")
                } else {
                    None
                };
                if let Some(np) = next_phase {
                    st.host.winio.update(DesktopMessage::SetStateAttr {
                        key: "phase".to_string(),
                        value: np.to_string(),
                    });
                    if let Some(a) = audio_guard.as_mut() {
                        a.trigger_cue("gear");
                    }
                }
            }
            "resume-game" => {
                st.host.winio.update(DesktopMessage::SetStateAttr {
                    key: "phase".to_string(),
                    value: "racing".to_string(),
                });
                if let Some(a) = audio_guard.as_mut() {
                    a.trigger_cue("gear");
                }
            }
            "restart-game" => {
                st.host.winio.update(DesktopMessage::SetStateAttr {
                    key: "phase".to_string(),
                    value: "title".to_string(),
                });
                if let Some(a) = audio_guard.as_mut() {
                    a.trigger_cue("gear");
                }
            }
            "cycle-station" => {
                st.station_index = (st.station_index + 1) % RADIO_STATIONS.len();
                let (freq, title, track) = RADIO_STATIONS[st.station_index];
                if let Some(a) = audio_guard.as_mut() {
                    a.start_music(track);
                }
                st.host.winio.update(DesktopMessage::UpdateScalar {
                    name: "stk-radio-station".to_string(),
                    value: format!("FM {} · {}", freq, title),
                });
            }
            "select-station-0" | "select-station-1" | "select-station-2" => {
                st.station_index = match action.as_str() {
                    "select-station-1" => 1,
                    "select-station-2" => 2,
                    _ => 0,
                };
                let (freq, title, track) = RADIO_STATIONS[st.station_index];
                if let Some(a) = audio_guard.as_mut() {
                    a.start_music(track);
                }
                st.host.winio.update(DesktopMessage::UpdateScalar {
                    name: "stk-radio-station".to_string(),
                    value: format!("FM {} · {}", freq, title),
                });
            }
            "toggle-mute" => {
                if let Some(a) = audio_guard.as_mut() {
                    if a.enabled {
                        st.saved_volume = a.volume.max(0.2);
                        a.set_volume(0.0);
                    } else {
                        let restore = st.saved_volume.max(0.2);
                        a.set_volume(restore);
                    }
                }
            }
            "set-volume" => {
                let v = (float_arg / 100.0).clamp(0.0, 1.0);
                st.saved_volume = v;
                st.host.winio.update(DesktopMessage::SetSliderValue {
                    field: "volume".to_string(),
                    value: float_arg,
                });
                if let Some(a) = audio_guard.as_mut() {
                    a.set_volume(v);
                }
            }
            _ => {}
        }
    }

    /// # Safety
    /// Caller must pass valid or null pointers matching the FFI contract.
    #[no_mangle]
    #[allow(clippy::too_many_arguments)]
    pub unsafe extern "C" fn apexrun_rust_sync_frame(
        pose_floats: *const f32,
        stage_state_cstr: *const c_char,
        track_name_cstr: *const c_char,
        off_road: i32,
        on_curb: i32,
        events_cstr: *const c_char,
        dyn_verts_out: *mut *const GpuVertex,
        dyn_vert_count_out: *mut usize,
        dyn_indices_out: *mut *const u32,
        dyn_index_count_out: *mut usize,
        hud_out: *mut MacHudSnapshotC,
    ) {
        let Some(lock) = APP_STATE.get() else {
            return;
        };
        let mut st = lock.lock().unwrap();

        if pose_floats.is_null() {
            unsafe {
                if !dyn_verts_out.is_null() {
                    *dyn_verts_out = st.dynamic_vertices.as_ptr();
                }
                if !dyn_vert_count_out.is_null() {
                    *dyn_vert_count_out = st.dynamic_vertices.len();
                }
                if !dyn_indices_out.is_null() {
                    *dyn_indices_out = st.dynamic_indices.as_ptr();
                }
                if !dyn_index_count_out.is_null() {
                    *dyn_index_count_out = st.dynamic_indices.len();
                }
            }
            return;
        }

        let mut pose = PoseBuffer::default();
        let slice = unsafe { std::slice::from_raw_parts(pose_floats, POSE_BUFFER_FLOATS) };
        pose.floats.copy_from_slice(slice);

        let stage_state = if !stage_state_cstr.is_null() {
            unsafe { CStr::from_ptr(stage_state_cstr) }
                .to_string_lossy()
                .to_string()
        } else {
            "title".to_string()
        };
        let track_name = if !track_name_cstr.is_null() {
            unsafe { CStr::from_ptr(track_name_cstr) }
                .to_string_lossy()
                .to_string()
        } else {
            "Coconut Beach".to_string()
        };
        let events = if !events_cstr.is_null() {
            unsafe { CStr::from_ptr(events_cstr) }
                .to_string_lossy()
                .to_string()
        } else {
            String::new()
        };

        let winio_phase = st
            .host
            .winio
            .state_attrs
            .get("phase")
            .cloned()
            .unwrap_or_else(|| "title".to_string());

        if (stage_state == "finished" || stage_state == "game_over") && winio_phase == "racing" {
            st.host.winio.update(DesktopMessage::SetStateAttr {
                key: "phase".to_string(),
                value: "result".to_string(),
            });
        }

        let (freq, title, _) = RADIO_STATIONS[st.station_index];
        let mut eq_bands = [0.2f32; 6];
        let mut station_str = format!("FM {} · {}", freq, title);
        let mut is_muted = false;
        let mut volume = 0.8f32;

        if let Some(audio_lock) = AUDIO_ENGINE.get() {
            let mut audio = audio_lock.lock().unwrap();
            let raw_speed = pose.floats[68];
            let rpm = pose.floats[69];
            assert!(
                raw_speed.is_finite() && rpm.is_finite(),
                "Non-finite speed or RPM in PoseBuffer"
            );
            let speed_kmh = if winio_phase == "paused" {
                0.0
            } else {
                raw_speed
            };
            let is_drifting = pose.floats[33] > 0.05;
            let is_nitro = pose.floats[34] > 0.5 || pose.floats[73] > 0.5;
            audio.update_engine(
                speed_kmh,
                is_drifting,
                is_nitro,
                rpm,
                off_road != 0,
                if on_curb != 0 { 0.85 } else { 0.0 },
            );
            if is_nitro && !st.last_nitro_active {
                audio.trigger_cue("slipstream");
            }
            st.last_nitro_active = is_nitro;

            let cd_code = pose.floats[60].round() as i32;
            if cd_code != st.last_countdown_code {
                st.last_countdown_code = cd_code;
                match cd_code {
                    1..=3 => audio.trigger_cue("countdown"),
                    4 => audio.trigger_cue("go"),
                    5 => audio.trigger_cue("checkpoint"),
                    6 => audio.trigger_cue("crash"),
                    _ => {}
                }
            }

            for ev in events.split(',').filter(|s| !s.is_empty()) {
                match ev {
                    "checkpoint-extended" => {
                        audio.trigger_cue("checkpoint");
                        st.checkpoint_banner_ticks = 120;
                    }
                    "rival-beaten" => audio.trigger_cue("checkpoint"),
                    "close-pass" | "drift-start" | "mini-turbo" => audio.trigger_cue("slipstream"),
                    "traffic-collision" | "prop-crash" => audio.trigger_cue("crash"),
                    _ => {}
                }
            }

            let lvls = audio.levels(6);
            for (i, &b) in lvls.iter().take(6).enumerate() {
                eq_bands[i] = b;
                pose.floats[84 + i] = b;
            }
            if !audio.enabled {
                station_str = format!("MUTED · {}", title);
            }
            is_muted = !audio.enabled;
            volume = audio.volume;
        }

        if st.checkpoint_banner_ticks > 0 {
            st.checkpoint_banner_ticks -= 1;
        }

        let stats = st.host.presenter.render_frame(&pose);
        let (dyn_v, dyn_i) = build_dynamic_frame_geometry(&pose);
        st.dynamic_vertices = dyn_v;
        st.dynamic_indices = dyn_i;

        // Evaluate Winio accessibility/visibility tree for slow HUD cards
        let a11y_tree = st.host.winio.render_accessibility_tree();
        let show_title = a11y_tree.find_by_id("stk-title-card").is_some();
        let show_pause = a11y_tree.find_by_id("stk-pause-card").is_some();
        let show_result = a11y_tree.find_by_id("stk-results-card").is_some();
        let is_paused = show_pause;

        let nitro_ratio = stats.fast_hud.nitro_ratio.clamp(0.0, 1.0);
        let nitro_active = pose.floats[73] > 0.5 || pose.floats[34] > 0.5;
        let nitro_charges = ((nitro_ratio * 3.0 + 1e-4).floor() as u32).min(3);
        // 0 = ready (#ffd700), 1 = boost (#4de8ff), 2 = charging (#78909c)
        let nitro_state = if nitro_active {
            1
        } else if nitro_charges > 0 {
            0
        } else {
            2
        };
        let route_progress = pose.floats[82].clamp(0.0, 1.0);
        let rival_gap = pose.floats[80].round() as i32;
        let rival_beaten = pose.floats[51] > 0.5;
        let rival_escaped = pose.floats[51] < -0.5;
        let rival_fill = if rival_beaten {
            1.0
        } else if rival_escaped {
            0.05
        } else {
            (1.0 - (pose.floats[80].max(0.0) / 120.0)).clamp(0.05, 1.0)
        };

        let mut snap = MacHudSnapshotC {
            show_title_card: u32::from(show_title),
            show_pause_card: u32::from(show_pause),
            show_result_card: u32::from(show_result),
            is_paused: u32::from(is_paused),
            is_muted: u32::from(is_muted),
            gear: pose.gear(),
            nitro_state,
            nitro_charges,
            nitro_ratio,
            tacho_ratio: stats.fast_hud.tacho_ratio,
            route_progress,
            rival_fill,
            volume,
            eq_bands,
            ..MacHudSnapshotC::default()
        };

        let clean_track = track_name.split('[').next().unwrap_or(&track_name).trim();
        let upper_track = clean_track.to_uppercase();
        let stage_str = format!("STAGE {} · {}", pose.stage_num(), upper_track);
        let score_str = format!("{:07}", pose.score());
        let speed_str = format!("{}", pose.speed_kmh());
        let rpm_str = format!("{} RPM", pose.rpm());
        write_cstr_buf(&mut snap.stage_label, &stage_str);
        write_cstr_buf(&mut snap.score_label, &score_str);
        write_cstr_buf(&mut snap.timer_label, &stats.fast_hud.timer_text);
        write_cstr_buf(&mut snap.speed_label, &speed_str);
        write_cstr_buf(&mut snap.rpm_label, &rpm_str);
        write_cstr_buf(&mut snap.station_label, &station_str);

        let nitro_str = match nitro_state {
            1 => "BOOST".to_string(),
            0 => format!("NITRO ×{}", nitro_charges),
            _ => "CHARGING".to_string(),
        };
        write_cstr_buf(&mut snap.nitro_label, &nitro_str);

        let velo_str = if nitro_active {
            "NITRO BOOST"
        } else if pose.speed_kmh() > 260 {
            "REDLINE"
        } else if pose.speed_kmh() > 5 {
            "CRUISING"
        } else {
            "IDLE"
        };
        write_cstr_buf(&mut snap.velo_mode_label, velo_str);

        let drift_pct = pose.floats[77].round() as i32;
        let is_drifting = pose.floats[33] > 0.05;
        let drift_str = if is_drifting && drift_pct >= 100 {
            "TURBO READY!".to_string()
        } else if is_drifting {
            let dir_ch = if pose.floats[32] < 0.0 {
                "◀"
            } else if pose.floats[32] > 0.0 {
                "▶"
            } else {
                ""
            };
            format!("DRIFT {}: {}%", dir_ch, drift_pct)
        } else if drift_pct > 0 {
            format!("CHARGE: {}%", drift_pct)
        } else {
            "TRACTION: NOMINAL".to_string()
        };
        write_cstr_buf(&mut snap.drift_label, &drift_str);

        let fork_dist = pose.floats[81].round() as i32;
        let (pyramid_idx, cp_code, left_dest, right_dest, has_fork) = match upper_track.as_str() {
            "COCONUT BEACH" => (0, "CHECKPOINT A-1", "DESERT CANYONS", "GATEWAY PASS", true),
            "DESERT CANYONS" => (1, "CHECKPOINT B-1", "ALPINE PEAKS", "WILDERNESS RUN", true),
            "GATEWAY PASS" => (2, "CHECKPOINT B-2", "WILDERNESS RUN", "TULIP GARDENS", true),
            "ALPINE PEAKS" | "ALPINE HEIGHTS" => {
                (3, "CHECKPOINT C-1", "SUNSET HIGHWAY", "ANCIENT RUINS", true)
            }
            "WILDERNESS RUN" => (4, "CHECKPOINT C-2", "ANCIENT RUINS", "METROPOLIS NIGHT", true),
            "TULIP GARDENS" => (5, "CHECKPOINT C-3", "METROPOLIS NIGHT", "COASTAL CLIFFS", true),
            "SUNSET HIGHWAY" => (6, "CHECKPOINT D-1", "MARINA BAY [A]", "DESERT OASIS [B]", true),
            "ANCIENT RUINS" => (7, "CHECKPOINT D-2", "DESERT OASIS [B]", "GRAND CASTLE [C]", true),
            "METROPOLIS NIGHT" => (8, "CHECKPOINT D-3", "GRAND CASTLE [C]", "COLOSSEUM [D]", true),
            "COASTAL CLIFFS" => (9, "CHECKPOINT D-4", "COLOSSEUM [D]", "AERODROME [E]", true),
            "MARINA BAY" => (10, "GOAL STAGE E-1", "FINISH LINE", "FINISH LINE", false),
            "DESERT OASIS" => (11, "GOAL STAGE E-2", "FINISH LINE", "FINISH LINE", false),
            "GRAND CASTLE" => (12, "GOAL STAGE E-3", "FINISH LINE", "FINISH LINE", false),
            "COLOSSEUM" => (13, "GOAL STAGE E-4", "FINISH LINE", "FINISH LINE", false),
            "AERODROME" => (14, "GOAL STAGE E-5", "FINISH LINE", "FINISH LINE", false),
            _ => (0, "CHECKPOINT A-1", "FINISH LINE", "FINISH LINE", false),
        };
        snap.pyramid_node_index = pyramid_idx;
        write_cstr_buf(&mut snap.checkpoint_code, cp_code);
        let matrix_fork_str = if !has_fork {
            "FINAL STAGE · GOAL AHEAD".to_string()
        } else if fork_dist > 0 {
            format!("FORK IN {}M", fork_dist)
        } else {
            "CHOOSE LANE!".to_string()
        };
        write_cstr_buf(&mut snap.matrix_fork_label, &matrix_fork_str);
        write_cstr_buf(&mut snap.branch_left_label, &format!("◀ [L] {}", left_dest));
        write_cstr_buf(&mut snap.branch_right_label, &format!("[R] {} ▶", right_dest));

        let rival_hdr = if rival_beaten {
            "RIVAL PASSED"
        } else if rival_escaped {
            "RIVAL ESCAPED"
        } else {
            "RIVAL AHEAD"
        };
        let rival_gap_str = if rival_beaten {
            format!("+{} m", rival_gap.abs())
        } else if rival_escaped {
            "AT GOAL".to_string()
        } else {
            format!("{} m", rival_gap.max(0))
        };
        write_cstr_buf(&mut snap.rival_header_label, rival_hdr);
        write_cstr_buf(&mut snap.rival_gap_label, &rival_gap_str);

        let rival_split_str = if rival_beaten {
            format!("LEAD +{:.2}s", (rival_gap.abs() as f32) * 0.032)
        } else if rival_escaped {
            "ESCAPED".to_string()
        } else if rival_gap > 0 {
            format!("RIVAL -{:.2}s", (rival_gap as f32) * 0.032)
        } else {
            "--".to_string()
        };
        write_cstr_buf(&mut snap.rival_label, &rival_split_str);

        let lat_g = pose.floats[78];
        let radar_z = pose.floats[83];
        let radar_str = if radar_z > 0.0 && radar_z < 67.0 {
            format!("WARNING {:.0}M", radar_z)
        } else if radar_z > 0.0 && radar_z < 150.0 {
            "TRAFFIC AHEAD".to_string()
        } else {
            "CLEAR".to_string()
        };
        let gforce_str = format!("{:+.1}G", lat_g);
        let slip_str = if pose.floats[79] > 0.5 {
            "LOCKED (+30 KM/H)"
        } else {
            "INACTIVE"
        };
        write_cstr_buf(&mut snap.radar_label, &radar_str);
        write_cstr_buf(&mut snap.gforce_label, &gforce_str);
        write_cstr_buf(&mut snap.slipstream_label, slip_str);
        write_cstr_buf(
            &mut snap.telemetry_label,
            &format!("LAT {:+.1}G · DRIFT {}% · {}", lat_g, drift_pct, radar_str),
        );

        let clear_stage = pose.floats[61].round() as i32;
        let swoop_stage = pose.floats[59].round() as i32;
        let banner = if clear_stage > 0 {
            format!("STAGE {} CLEAR · EXTENDED PLAY +45s", clear_stage)
        } else if st.checkpoint_banner_ticks > 0 {
            "CHECKPOINT +45s!".to_string()
        } else if let Some(ref mb) = stats.fast_hud.moment_banner {
            mb.clone()
        } else if swoop_stage > 0 {
            format!("STAGE {} · {}", swoop_stage, upper_track)
        } else {
            String::new()
        };
        write_cstr_buf(&mut snap.banner_label, &banner);
        write_cstr_buf(
            &mut snap.result_summary,
            &format!(
                "STAGE {} ({}) · SCORE {:07}",
                pose.stage_num(),
                upper_track,
                pose.score()
            ),
        );

        for (layer, val) in [
            ("stk-track-name", stage_str.as_str()),
            ("stk-radio-station", station_str.as_str()),
            ("score", score_str.as_str()),
            ("timer", stats.fast_hud.timer_text.as_str()),
            ("speed", speed_str.as_str()),
            ("rpm", rpm_str.as_str()),
            ("nitro-text", nitro_str.as_str()),
            ("velo-mode", velo_str),
            ("drift", drift_str.as_str()),
            ("matrix-fork", matrix_fork_str.as_str()),
            ("rival-gap", rival_gap_str.as_str()),
            ("rival-split", rival_split_str.as_str()),
            ("radar", radar_str.as_str()),
            ("gforce", gforce_str.as_str()),
            ("slipstream", slip_str),
        ] {
            st.host.winio.update(DesktopMessage::UpdateScalar {
                name: layer.to_string(),
                value: val.to_string(),
            });
        }

        unsafe {
            if !dyn_verts_out.is_null() {
                *dyn_verts_out = st.dynamic_vertices.as_ptr();
            }
            if !dyn_vert_count_out.is_null() {
                *dyn_vert_count_out = st.dynamic_vertices.len();
            }
            if !dyn_indices_out.is_null() {
                *dyn_indices_out = st.dynamic_indices.as_ptr();
            }
            if !dyn_index_count_out.is_null() {
                *dyn_index_count_out = st.dynamic_indices.len();
            }
            if !hud_out.is_null() {
                *hud_out = snap;
            }
        }
    }

    /// # Safety
    /// Caller must pass valid or null pointers for `out_width` and `out_height`.
    #[no_mangle]
    pub unsafe extern "C" fn apexrun_rust_get_prop_atlas(
        out_width: *mut u32,
        out_height: *mut u32,
    ) -> *const u8 {
        let (ptr, w, h) = apex_art_atlas_rgba();
        unsafe {
            if !out_width.is_null() {
                *out_width = w;
            }
            if !out_height.is_null() {
                *out_height = h;
            }
        }
        ptr
    }

    /// # Safety
    /// Caller must pass a valid buffer of `frames * 2` floats when `out_stereo` is non-null.
    #[no_mangle]
    pub unsafe extern "C" fn apexrun_rust_render_audio(out_stereo: *mut f32, frames: usize) {
        if out_stereo.is_null() || frames == 0 {
            return;
        }
        let slice = unsafe { std::slice::from_raw_parts_mut(out_stereo, frames * 2) };
        let Some(audio_lock) = AUDIO_ENGINE.get() else {
            slice.fill(0.0);
            return;
        };
        if let Ok(mut audio) = audio_lock.try_lock() {
            let pcm = audio.render_pcm_stereo(frames);
            slice.copy_from_slice(&pcm);
        } else {
            slice.fill(0.0);
        }
    }

    #[repr(C)]
    #[derive(Debug, Clone, Copy)]
    pub struct StagePaletteC {
        pub sky_file: *const c_char,
        pub far_file: *const c_char,
        pub mid_file: *const c_char,
        pub ground_file: *const c_char,
        pub ground_tile: f32,
        pub turn: f32,
        pub sun_dir: [f32; 3],
        pub horizon_srgb: [f32; 3],
        pub toon_sun: [f32; 3],
        pub toon_shade: [f32; 3],
        pub sun_col: [f32; 3],
        pub has_sun: f32,
    }

    /// # Safety
    /// Caller must pass a valid pointer for `out_palette` and a valid or null C string for `stage_id_cstr`.
    #[no_mangle]
    pub unsafe extern "C" fn apexrun_rust_get_stage_palette(
        stage_id_cstr: *const c_char,
        out_palette: *mut StagePaletteC,
    ) {
        if out_palette.is_null() {
            return;
        }
        let stage_id = if !stage_id_cstr.is_null() {
            unsafe { CStr::from_ptr(stage_id_cstr) }
                .to_string_lossy()
                .to_string()
        } else {
            "coconut-beach".to_string()
        };
        let pal = match stage_id.as_str() {
            "desert-canyons" => StagePaletteC {
                sky_file: manifest_file_cstr("sky/desert-canyons.paint.jpg"),
                far_file: manifest_file_cstr("backdrop/desert-canyons.far"),
                mid_file: manifest_file_cstr("backdrop/desert-canyons.mid"),
                ground_file: manifest_file_cstr("tex/sand-desert/albedo"),
                ground_tile: 9.0,
                turn: -3.1803,
                sun_dir: [0.5329, 0.4739, 0.7010],
                horizon_srgb: [0.8577, 0.8737, 0.8112],
                toon_sun: [1.175, 1.125, 1.015],
                toon_shade: [0.679, 0.769, 0.877],
                sun_col: [1.00, 0.97, 0.87],
                has_sun: 1.0,
            },
            "gateway-pass" => StagePaletteC {
                sky_file: manifest_file_cstr("sky/gateway-pass.paint.jpg"),
                far_file: manifest_file_cstr("backdrop/gateway-pass.far"),
                mid_file: manifest_file_cstr("backdrop/gateway-pass.mid"),
                ground_file: manifest_file_cstr("tex/grass/albedo"),
                ground_tile: 9.0,
                turn: 0.0,
                sun_dir: [0.0, 0.35, 0.936],
                horizon_srgb: [0.6434, 0.7758, 0.7788],
                toon_sun: [1.175, 1.135, 1.048],
                toon_shade: [0.745, 0.797, 0.892],
                sun_col: [1.00, 0.78, 0.64],
                has_sun: 0.0,
            },
            "alpine-heights" | "alpine-peaks" => StagePaletteC {
                sky_file: manifest_file_cstr("sky/alpine-peaks.paint.jpg"),
                far_file: manifest_file_cstr("backdrop/alpine-peaks.far"),
                mid_file: manifest_file_cstr("backdrop/alpine-peaks.mid"),
                ground_file: manifest_file_cstr("tex/snow/albedo"),
                ground_tile: 9.0,
                turn: -3.1936,
                sun_dir: [0.5159, 0.5227, 0.6787],
                horizon_srgb: [0.6709, 0.7887, 0.7954],
                toon_sun: [1.173, 1.135, 1.029],
                toon_shade: [0.694, 0.792, 0.892],
                sun_col: [1.00, 1.00, 1.00],
                has_sun: 1.0,
            },
            "wilderness-run" => StagePaletteC {
                sky_file: manifest_file_cstr("sky/wilderness-run.paint.jpg"),
                far_file: manifest_file_cstr("backdrop/wilderness-run.far"),
                mid_file: manifest_file_cstr("backdrop/wilderness-run.mid"),
                ground_file: manifest_file_cstr("tex/forest-floor/albedo"),
                ground_tile: 9.0,
                turn: 0.0,
                sun_dir: [0.1830, 0.3894, 0.9027],
                horizon_srgb: [0.6051, 0.7528, 0.7611],
                toon_sun: [1.175, 1.135, 1.048],
                toon_shade: [0.726, 0.826, 0.892],
                sun_col: [0.91, 0.92, 0.85],
                has_sun: 0.0,
            },
            "tulip-gardens" => StagePaletteC {
                sky_file: manifest_file_cstr("sky/tulip-gardens.paint.jpg"),
                far_file: manifest_file_cstr("backdrop/tulip-gardens.far"),
                mid_file: manifest_file_cstr("backdrop/tulip-gardens.mid"),
                ground_file: manifest_file_cstr("tex/tulip-field/albedo"),
                ground_tile: 16.0,
                turn: -3.1604,
                sun_dir: [0.5159, 0.5227, 0.6787],
                horizon_srgb: [0.6806, 0.7730, 0.7893],
                toon_sun: [1.175, 1.083, 0.918],
                toon_shade: [0.765, 0.852, 0.888],
                sun_col: [1.00, 0.98, 0.91],
                has_sun: 1.0,
            },
            "sunset-highway" => StagePaletteC {
                sky_file: manifest_file_cstr("sky/sunset-highway.paint.jpg"),
                far_file: manifest_file_cstr("backdrop/sunset-highway.far"),
                mid_file: manifest_file_cstr("backdrop/sunset-highway.mid"),
                ground_file: manifest_file_cstr("tex/sand-desert/albedo"),
                ground_tile: 9.0,
                turn: 0.0,
                sun_dir: [-0.22, 0.135, 0.966],
                horizon_srgb: [0.84, 0.52, 0.32],
                toon_sun: [1.18, 0.88, 0.62],
                toon_shade: [0.34, 0.36, 0.52],
                sun_col: [1.00, 0.66, 0.28],
                has_sun: 1.0,
            },
            "ancient-ruins" => StagePaletteC {
                sky_file: manifest_file_cstr("sky/ancient-ruins.paint.jpg"),
                far_file: manifest_file_cstr("backdrop/ancient-ruins.far"),
                mid_file: manifest_file_cstr("backdrop/ancient-ruins.mid"),
                ground_file: manifest_file_cstr("tex/grass/albedo"),
                ground_tile: 9.0,
                turn: -2.9229,
                sun_dir: [0.5906, 0.2182, 0.7769],
                horizon_srgb: [0.8727, 0.8811, 0.8267],
                toon_sun: [1.175, 1.098, 0.914],
                toon_shade: [0.764, 0.832, 0.879],
                sun_col: [1.00, 0.88, 0.63],
                has_sun: 1.0,
            },
            "metropolis-night" => StagePaletteC {
                sky_file: manifest_file_cstr("sky/metropolis-night.paint.jpg"),
                far_file: manifest_file_cstr("backdrop/metropolis-night.far"),
                mid_file: manifest_file_cstr("backdrop/metropolis-night.mid"),
                ground_file: manifest_file_cstr("tex/cobble/albedo"),
                ground_tile: 9.0,
                turn: 0.0,
                sun_dir: [-0.2863, 0.2474, 0.9256],
                horizon_srgb: [0.1820, 0.1563, 0.2090],
                toon_sun: [1.080, 1.060, 1.120],
                toon_shade: [0.620, 0.580, 0.680],
                sun_col: [0.87, 0.90, 1.00],
                has_sun: 0.0,
            },
            "coastal-cliffs" => StagePaletteC {
                sky_file: manifest_file_cstr("sky/coconut-beach.paint.jpg"),
                far_file: manifest_file_cstr("backdrop/coastal-cliffs.far"),
                mid_file: manifest_file_cstr("backdrop/coastal-cliffs.mid"),
                ground_file: manifest_file_cstr("tex/grass/albedo"),
                ground_tile: 9.0,
                turn: -3.1628,
                sun_dir: [0.5906, 0.2182, 0.7769],
                horizon_srgb: [0.8079, 0.8531, 0.8144],
                toon_sun: [1.175, 0.968, 0.806],
                toon_shade: [0.744, 0.819, 0.882],
                sun_col: [0.94, 0.96, 0.94],
                has_sun: 1.0,
            },
            "goal-a" | "destination-marina" => StagePaletteC {
                sky_file: manifest_file_cstr("sky/coconut-beach.paint.jpg"),
                far_file: manifest_file_cstr("backdrop/destination-marina.far"),
                mid_file: manifest_file_cstr("backdrop/destination-marina.mid"),
                ground_file: manifest_file_cstr("tex/sand-beach/albedo"),
                ground_tile: 9.0,
                turn: -3.1628,
                sun_dir: [0.5906, 0.2182, 0.7769],
                horizon_srgb: [0.8079, 0.8531, 0.8144],
                toon_sun: [1.175, 0.968, 0.806],
                toon_shade: [0.744, 0.819, 0.882],
                sun_col: [1.00, 1.00, 1.00],
                has_sun: 1.0,
            },
            "goal-b" | "destination-oasis" => StagePaletteC {
                sky_file: manifest_file_cstr("sky/desert-canyons.paint.jpg"),
                far_file: manifest_file_cstr("backdrop/destination-oasis.far"),
                mid_file: manifest_file_cstr("backdrop/destination-oasis.mid"),
                ground_file: manifest_file_cstr("tex/sand-desert/albedo"),
                ground_tile: 9.0,
                turn: -3.1803,
                sun_dir: [0.5329, 0.4739, 0.7010],
                horizon_srgb: [0.8577, 0.8737, 0.8112],
                toon_sun: [1.175, 1.125, 1.015],
                toon_shade: [0.679, 0.769, 0.877],
                sun_col: [1.00, 0.82, 0.54],
                has_sun: 1.0,
            },
            "goal-c" | "destination-castle" => StagePaletteC {
                sky_file: manifest_file_cstr("sky/wilderness-run.paint.jpg"),
                far_file: manifest_file_cstr("backdrop/destination-castle.far"),
                mid_file: manifest_file_cstr("backdrop/destination-castle.mid"),
                ground_file: manifest_file_cstr("tex/grass/albedo"),
                ground_tile: 9.0,
                turn: 0.0,
                sun_dir: [-0.3892, 0.30, 0.871],
                horizon_srgb: [0.6051, 0.7528, 0.7611],
                toon_sun: [1.175, 1.135, 1.048],
                toon_shade: [0.726, 0.826, 0.892],
                sun_col: [0.91, 0.85, 1.00],
                has_sun: 0.0,
            },
            "goal-d" | "destination-colosseum" => StagePaletteC {
                sky_file: manifest_file_cstr("sky/ancient-ruins.paint.jpg"),
                far_file: manifest_file_cstr("backdrop/destination-colosseum.far"),
                mid_file: manifest_file_cstr("backdrop/destination-colosseum.mid"),
                ground_file: manifest_file_cstr("tex/ruins-stone/albedo"),
                ground_tile: 9.0,
                turn: -2.9229,
                sun_dir: [0.5906, 0.2182, 0.7769],
                horizon_srgb: [0.8727, 0.8811, 0.8267],
                toon_sun: [1.175, 1.098, 0.914],
                toon_shade: [0.764, 0.832, 0.879],
                sun_col: [1.00, 0.94, 0.78],
                has_sun: 1.0,
            },
            "goal-e" | "destination-aerodrome" => StagePaletteC {
                sky_file: manifest_file_cstr("sky/tulip-gardens.paint.jpg"),
                far_file: manifest_file_cstr("backdrop/destination-aerodrome.far"),
                mid_file: manifest_file_cstr("backdrop/destination-aerodrome.mid"),
                ground_file: manifest_file_cstr("tex/grass/albedo"),
                ground_tile: 9.0,
                turn: -3.1604,
                sun_dir: [0.5159, 0.5227, 0.6787],
                horizon_srgb: [0.6806, 0.7730, 0.7893],
                toon_sun: [1.175, 1.083, 0.918],
                toon_shade: [0.765, 0.852, 0.888],
                sun_col: [1.00, 0.85, 0.69],
                has_sun: 1.0,
            },
            _ => StagePaletteC {
                sky_file: manifest_file_cstr("sky/coconut-beach.paint.jpg"),
                far_file: manifest_file_cstr("backdrop/coconut-beach.far"),
                mid_file: manifest_file_cstr("backdrop/coconut-beach.mid"),
                ground_file: manifest_file_cstr("tex/grass/albedo"),
                ground_tile: 9.0,
                turn: -3.1628,
                sun_dir: [-0.26, 0.135, 0.956],
                horizon_srgb: [0.82, 0.54, 0.36],
                toon_sun: [1.18, 0.88, 0.64],
                toon_shade: [0.32, 0.36, 0.50],
                sun_col: [1.00, 0.68, 0.30],
                has_sun: 1.0,
            },
        };
        unsafe {
            *out_palette = pal;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use omnishell_bevy_presenter::TARGET_120FPS_BUDGET_US;

    #[test]
    fn slice3_gate1_120fps_frame_cost_and_stage_glb_contract() {
        let mut host =
            OmnishellDesktopHost::boot_apexrun(NativeBackend::host_default()).expect("boot host");

        // Verify stage .glb contract parsed into Bevy presenter
        let stage = host
            .presenter
            .current_stage
            .as_ref()
            .expect("loaded stage scene");
        assert_eq!(stage.stage_id, "coconut-beach");
        assert_eq!(stage.sky_ktx2, "sky/coconut-beach.ktx2");
        assert_eq!(stage.shore_side, -1);
        assert!(stage.chunks.len() > 10, "expected instanced scatter chunks");
        assert!(
            stage
                .materials
                .iter()
                .any(|m| m.shader_defines.contains(&"STK_TOON".to_string())),
            "expected STK_TOON material shader define"
        );
        assert!(
            stage
                .materials
                .iter()
                .any(|m| m.shader_defines.contains(&"STK_SWAY".to_string())),
            "expected STK_SWAY foliage shader define"
        );
        assert_eq!(stage.textures.len(), 3);

        // Transition to racing phase and run 120 consecutive frames at 2560x1440 native resolution
        host.winio.update(DesktopMessage::SetStateAttr {
            key: "phase".to_string(),
            value: "racing".to_string(),
        });

        host.tick_frame(DuelInput::default(), DuelInput::default());
        let mut total_frame_us = 0u64;
        let mut saw_visible_chunks = false;

        for f in 0..120 {
            let s0 = DuelInput {
                up: true,
                shift: f > 30,
                left: (f / 15) % 2 == 0,
                ..Default::default()
            };
            let s1 = DuelInput {
                up: true,
                right: (f / 20) % 2 == 1,
                ..Default::default()
            };
            let stats = host.tick_frame(s0, s1);
            total_frame_us += stats.frame_time_us;
            if stats.visible_chunks > 0 && stats.culled_chunks > 0 {
                saw_visible_chunks = true;
            }
        }

        let avg_frame_us = total_frame_us / 120;
        assert!(
            avg_frame_us < TARGET_120FPS_BUDGET_US,
            "Average frame time {} us exceeded 120 fps budget ({} us)",
            avg_frame_us,
            TARGET_120FPS_BUDGET_US
        );
        assert!(
            saw_visible_chunks,
            "Expected frustum/distance culling to partition visible vs culled chunks"
        );
    }

    #[test]
    fn slice3_gate2_slow_hud_accessibility_tree_and_phase_visibility() {
        let mut host =
            OmnishellDesktopHost::boot_apexrun(NativeBackend::host_default()).expect("boot host");

        // 1. In `phase="title"`, `stk-title-card` is visible; `stk-results-card` and `stk-pause-card` are hidden
        let title_tree = host.winio.render_accessibility_tree();
        assert!(
            title_tree.find_by_id("stk-title-card").is_some(),
            "stk-title-card must be in accessibility tree during title phase"
        );
        assert!(
            title_tree.find_by_id("stk-results-card").is_none(),
            "stk-results-card must be hidden during title phase"
        );
        assert!(
            title_tree.find_by_id("stk-pause-card").is_none(),
            "stk-pause-card must be hidden during title phase"
        );
        // `.touch-only` mobile zones are omitted from the desktop `winio` tree at projection time
        assert!(
            title_tree.find_by_id("touch-deck").is_none(),
            ".touch-only overlay must be omitted from desktop winio tree"
        );

        // Open online lobby (`open="yes"`): `stk-lobby-card` appears and `stk-title-card` hides
        host.winio.update(DesktopMessage::SetStateAttr {
            key: "open".to_string(),
            value: "yes".to_string(),
        });
        let lobby_tree = host.winio.render_accessibility_tree();
        assert!(
            lobby_tree.find_by_id("stk-lobby-card").is_some(),
            "stk-lobby-card must appear in accessibility tree when open=yes"
        );

        let mut interactive = Vec::new();
        lobby_tree.collect_interactive(&mut interactive);
        assert!(
            interactive.iter().any(|n| n.role == "textbox"),
            "Expected challenge link Edit textbox in accessibility tree"
        );
        assert!(
            interactive.iter().any(|n| n.role == "button"),
            "Expected interactive buttons in accessibility tree"
        );

        // Close lobby and check slider on title card
        host.winio.update(DesktopMessage::SetStateAttr {
            key: "open".to_string(),
            value: "no".to_string(),
        });
        let mut title_interactive = Vec::new();
        host.winio
            .render_accessibility_tree()
            .collect_interactive(&mut title_interactive);
        assert!(
            title_interactive.iter().any(|n| n.role == "slider"),
            "Expected volume Slider in accessibility tree"
        );

        // 2. Transition to `phase="racing"`: modal scrim hides, pause button remains accessible
        host.winio.update(DesktopMessage::SetStateAttr {
            key: "phase".to_string(),
            value: "racing".to_string(),
        });
        let racing_tree = host.winio.render_accessibility_tree();
        assert!(
            racing_tree.find_by_id("stk-title-card").is_none(),
            "stk-title-card must hide during racing phase"
        );
        assert!(
            racing_tree.find_by_id("stk-pause-btn").is_some(),
            "stk-pause-btn must be in accessibility tree during racing phase"
        );

        // 3. Transition to `phase="result"`: results card appears
        host.winio.update(DesktopMessage::SetStateAttr {
            key: "phase".to_string(),
            value: "result".to_string(),
        });
        let result_tree = host.winio.render_accessibility_tree();
        assert!(
            result_tree.find_by_id("stk-results-card").is_some(),
            "stk-results-card must appear in accessibility tree during result phase"
        );
    }

    #[test]
    fn slice3_gate3_ggrs_online_duel_rollback_parity_against_web_peer() {
        let goal_z_mm = 80_000; // 80 m sprint
        // Peer A (Desktop native GGRS host, local seat 0) with 3-frame network delay on remote seat 1
        let mut desktop_peer = GgrsDuelSession::new(goal_z_mm);
        // Peer B (Web reference lockstep peer receiving exact inputs without prediction error)
        let mut web_peer = GgrsDuelSession::new(goal_z_mm);

        let total_frames = 180u32;
        let mut remote_history: BTreeMap<u32, DuelInput> = BTreeMap::new();

        for tick in 1..=total_frames {
            let s0 = DuelInput {
                up: true,
                shift: tick > 25 && tick < 110,
                left: (tick / 12) % 2 == 0,
                ..Default::default()
            };
            let s1_actual = DuelInput {
                up: true,
                shift: tick > 45 && tick < 95,
                right: (tick / 10) % 2 == 1,
                ..Default::default()
            };
            remote_history.insert(tick, s1_actual);

            // Web peer steps with exact inputs
            web_peer.step_frame(0, s0, s1_actual);

            // Desktop peer predicts remote seat 1 using its input from 3 frames ago
            let predicted_s1 = remote_history
                .get(&tick.saturating_sub(3))
                .copied()
                .unwrap_or_default();
            desktop_peer.step_frame(0, s0, predicted_s1);

            // Deliver delayed remote packet from 2 frames ago
            if tick > 2 {
                let delayed_tick = tick - 2;
                let actual = remote_history[&delayed_tick];
                desktop_peer
                    .receive_remote_input(1, delayed_tick, actual)
                    .expect("rollback resimulate");
            }
        }

        // Flush final 2 delayed packets at end of duel
        for delayed_tick in (total_frames - 1)..=total_frames {
            let actual = remote_history[&delayed_tick];
            desktop_peer
                .receive_remote_input(1, delayed_tick, actual)
                .expect("final rollback flush");
        }

        assert!(
            desktop_peer.rollback_count > 0,
            "Expected GGRS session to execute rollbacks on prediction mismatch"
        );
        assert_eq!(
            desktop_peer.state.checksum(),
            web_peer.state.checksum(),
            "Desktop GGRS rollback state checksum must match Web peer bit-for-bit"
        );
        assert_eq!(desktop_peer.state.seats, web_peer.state.seats);
        assert_eq!(desktop_peer.state.winner, 1, "Seat 1 (nitro burst) should win the sprint");
        assert_eq!(desktop_peer.state.seats[0].z_mm, 434_640);
        assert_eq!(desktop_peer.state.seats[0].nitro_milli, 28_600);
        assert_eq!(desktop_peer.state.seats[1].nitro_milli, 58_350);
    }

    #[test]
    fn slice5_desktop_audio_bridge_parity_and_pcm_synthesis() {
        let mut sound = NativeSoundEngine::new(48_000);

        // 1. Idle -> 260 km/h drive -> idle (mirrors `tests/audio.test.ts` case 1)
        sound.update_engine(0.0, false, false, 900.0, false, 0.0);
        let idle_freq = sound.harmonics[1].frequency.value;
        let idle_gain = sound.engine_master_gain.value;
        assert!(
            idle_freq > 15.0 && idle_freq < 95.0,
            "idle fundamental={} Hz",
            idle_freq
        );
        assert!(idle_gain <= 0.12, "idle gain={}", idle_gain);

        sound.update_engine(260.0, false, true, 7400.0, false, 0.0);
        let fast_freq = sound.harmonics[1].frequency.value;
        let fast_gain = sound.engine_master_gain.value;
        let fast_filter = sound.engine_filter_freq.value;
        assert!(
            fast_freq > idle_freq * 1.5,
            "fast={} should exceed idle={}",
            fast_freq,
            idle_freq
        );
        assert!(
            fast_gain > idle_gain,
            "fast gain={} should exceed idle={}",
            fast_gain,
            idle_gain
        );
        assert!(fast_filter > 600.0, "fast filter={}", fast_filter);

        // 2. Surface feedback (off-road gravel, curb rumble, drift squeal)
        sound.update_engine(180.0, true, false, 5800.0, true, 0.9);
        assert!(sound.offroad_gain.value > 0.01);
        assert!(sound.curb_gain.value > 0.01);
        assert!(sound.tire_squeal_gain.value > 0.01);

        // 3. Transient cues & synthwave music + 6-band EQ spectrum (`levels(6)`)
        sound.start_music("magical_sound_shower");
        sound.trigger_cue("checkpoint");
        sound.trigger_cue("splash");
        let bands = sound.levels(6);
        assert_eq!(bands.len(), 6);
        assert!(
            bands.iter().any(|&b| b > 0.0 && b <= 1.0),
            "Expected active normalized EQ bars, got {:?}",
            bands
        );

        // 4. Live 48 kHz stereo PCM buffer synthesis
        let pcm = sound.render_pcm_stereo(512);
        assert_eq!(pcm.len(), 1024);
        let peak = pcm.iter().fold(0.0f32, |acc, &x| acc.max(x.abs()));
        assert!(
            peak > 0.01 && peak <= 1.0,
            "Expected non-zero clamped stereo PCM output, peak={}",
            peak
        );

        // Mute silences master gain and levels
        sound.set_volume(0.0);
        assert!(!sound.enabled);
        assert_eq!(sound.levels(6), vec![0.0; 6]);
    }

    #[test]
    fn macos_app_glb_mesh_extraction_and_ffi_sync() {
        let mut js_ptr: *const std::ffi::c_char = std::ptr::null();
        let mut js_len: usize = 0;
        assert!(unsafe { macos_ffi::apexrun_rust_init(&mut js_ptr, &mut js_len) });
        assert!(!js_ptr.is_null());
        assert!(js_len > 100_000, "expected bundled JS > 100KB, got {}", js_len);

        let mut s_verts: *const omnishell_bevy_presenter::GpuVertex = std::ptr::null();
        let mut s_vert_count: usize = 0;
        let mut s_inds: *const u32 = std::ptr::null();
        let mut s_ind_count: usize = 0;
        unsafe {
            macos_ffi::apexrun_rust_get_static_mesh(
                &mut s_verts,
                &mut s_vert_count,
                &mut s_inds,
                &mut s_ind_count,
            );
        }
        assert!(s_vert_count > 10_000, "expected >10k static stage vertices, got {}", s_vert_count);
        assert!(s_ind_count > 15_000, "expected >15k static stage indices, got {}", s_ind_count);
    }
}
