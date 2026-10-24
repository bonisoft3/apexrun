// Live-synthesized sound: engine, wind, tyres, race cues and a three-station
// FM radio. The app ships no audio files; every note is composed below. A
// Jessie sound role (program.cue `surface.engines.sound`): the terminal hands
// `createSound` the AudioContext it endows, tamed of every way out but the
// speakers (omnishell's kinetic-sound.js).
import { createPrng } from './prng.js';

// A station loops four bars of 16 sixteenth-note steps. Chords are MIDI note
// lists, one per bar; bass offsets are semitones above each bar's root.
const NEON_CHORDS = [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]];

export const STATIONS = [
  {
    id: 'palm-drive', freq: '88.5', name: 'Palm Drive', genre: 'synth samba', bpm: 132,
    leadWave: 'square', bassWave: 'triangle',
    chords: [[62, 66, 69, 73], [59, 62, 66, 69], [55, 59, 62, 66], [57, 61, 64, 67]],
    roots: [38, 35, 43, 33],
    bass: [0, null, null, 7, null, null, 12, null, 0, null, null, 7, null, null, 12, null],
    kick: 'x.....x.x.......',
    snare: '..x..x...x..x.x.',
    hat: 'xxxxxxxxxxxxxxxx',
    lead: [
      [0, 78, 2], [2, 81, 2], [4, 83, 4], [10, 81, 2], [12, 78, 4],
      [16, 76, 2], [18, 78, 2], [20, 81, 6], [28, 83, 2], [30, 81, 2],
      [32, 83, 2], [34, 86, 4], [38, 83, 2], [40, 81, 4], [44, 79, 4],
      [48, 81, 2], [50, 85, 2], [52, 88, 4], [58, 85, 2], [60, 81, 4],
    ],
  },
  {
    id: 'tidal-breeze', freq: '92.1', name: 'Tidal Breeze', genre: 'jazz fusion', bpm: 104,
    leadWave: 'sine', bassWave: 'triangle',
    chords: [[53, 57, 60, 64, 67], [57, 60, 64, 67], [50, 53, 57, 60, 64], [46, 50, 53, 57]],
    roots: [41, 45, 38, 46],
    bass: [0, null, null, null, 7, null, null, null, 12, null, null, null, 10, null, null, null],
    kick: 'x.........x.....',
    snare: '....x.......x...',
    hat: 'x.x.x.x.x.x.x.x.',
    lead: [
      [2, 81, 3], [6, 79, 2], [8, 76, 4], [14, 72, 2],
      [16, 76, 2], [18, 79, 2], [20, 84, 6], [28, 83, 4],
      [34, 81, 2], [36, 77, 2], [38, 76, 2], [40, 74, 8],
      [48, 77, 2], [50, 81, 2], [52, 86, 4], [58, 84, 2], [60, 81, 4],
    ],
  },
  {
    id: 'neon-surf', freq: '97.3', name: 'Neon Surf', genre: 'synthwave', bpm: 118,
    leadWave: 'sawtooth', bassWave: 'sawtooth',
    chords: NEON_CHORDS,
    roots: [45, 41, 48, 43],
    bass: [0, null, 12, null, 0, null, 12, null, 0, null, 12, null, 0, null, 12, null],
    kick: 'x...x...x...x...',
    snare: '....x.......x...',
    hat: '..x...x...x...x.',
    lead: NEON_CHORDS.flatMap((chord, bar) => [0, 2, 4, 6, 8, 10, 12, 14].map((s, k) => (
      [bar * 16 + s, chord[[0, 1, 2, 1][k % 4]] + 12, 2]
    ))),
  },
];

const LOOP_STEPS = 64;

// Each station's lead notes by loop step, so a step finds its notes directly.
const LEAD_BY_STEP = new Map(STATIONS.map((st) => {
  const steps = Array.from({ length: LOOP_STEPS }, () => []);
  for (const [at, note, len] of st.lead) steps[at].push([note, len]);
  return [st, steps];
}));
const LOOKAHEAD = 0.12;

// Every note a station plays between two beats (quarter notes from the song's
// start), in order; the same window always yields the same notes.
export function scheduleStation(station, fromBeat, toBeat) {
  const events = [];
  for (let step = Math.ceil(fromBeat * 4); step < toBeat * 4; step++) {
    const loop = step % LOOP_STEPS;
    const bar = Math.floor(loop / 16);
    const s = loop % 16;
    const beat = step / 4;
    if (station.kick[s] === 'x') events.push({ beat, voice: 'kick', note: 0, dur: 0.5, vel: 1 });
    if (station.snare[s] === 'x') events.push({ beat, voice: 'snare', note: 0, dur: 0.25, vel: 0.8 });
    if (station.hat[s] === 'x') events.push({ beat, voice: 'hat', note: 0, dur: 0.125, vel: s % 4 === 0 ? 0.7 : 0.4 });
    if (station.bass[s] !== null) events.push({ beat, voice: 'bass', note: station.roots[bar] + station.bass[s], dur: 0.45, vel: 0.9 });
    if (s === 0) for (const note of station.chords[bar]) events.push({ beat, voice: 'pad', note, dur: 4, vel: 0.5 });
    for (const [note, len] of LEAD_BY_STEP.get(station)[loop]) {
      events.push({ beat, voice: 'lead', note, dur: len / 4, vel: 0.8 });
    }
  }
  return events;
}

// The mix: the radio leads, the car sits under it.
export const MIX = { radio: 0.7, engineIdle: 0.06, engineRev: 0.14, wind: 0.12 };

// The engine's pitch follows the crank, the filter opens with road speed.
export function engineVoice({ rpm, speed, gear, isNitro }) {
  const rev = Math.max(0, Math.min(1, (rpm - 1000) / 8000));
  return {
    freq: (rpm / 60) * 1.5 * (isNitro ? 1.1 : 1),
    cutoff: 300 + speed * 6 + (gear === 'high' ? 200 : 0),
    gain: MIX.engineIdle + MIX.engineRev * rev,
  };
}

const midiHz = (n) => 440 * 2 ** ((n - 69) / 12);

// Cue voices for race events; events without a cue are silent.
const CUES = {
  'close-pass': (v, t) => v.noise(t, { type: 'bandpass', from: 400, to: 3200, q: 3, len: 0.35, attack: 0.1, vel: 0.5 }),
  'traffic-collision': (v, t) => { v.thump(t, 90, 0.9); v.noise(t, { type: 'lowpass', from: 900, len: 0.25, vel: 0.7 }); },
  'checkpoint-extended': (v, t) => v.arpeggio(t, [84, 88, 91, 96], 0.09, 'square', 0.25),
  'fork-approach': (v, t) => v.arpeggio(t, [79, 86], 0.18, 'sine', 0.3),
  'race-start': (v, t) => v.arpeggio(t, [84], 0.3, 'square', 0.3),
  'race-finish': (v, t) => v.arpeggio(t, [72, 76, 79, 84, 88, 91, 96], 0.12, 'square', 0.3),
  'time-out': (v, t) => v.arpeggio(t, [67, 63, 60, 55], 0.22, 'triangle', 0.35),
  'mini-turbo': (v, t) => v.noise(t, { type: 'bandpass', from: 300, to: 1800, q: 3, len: 0.3, attack: 0.09, vel: 0.35 }),
};

// The mix over the context the terminal hands in, built on the first gesture
// (`resume`), since a browser allows sound only after one. The noise bed is
// the same every launch: its samples come from a fixed seed, not the clock.
export function createSound(createContext) {
  let ctx = null;
  let stationIndex = 0;
  let volume = 0.7;
  let muted = false;
  let master, analyser, bins, noiseBuffer, engineFilter, engineGain, engineOscs, windGain, tyreGain;
  let songBus = null;
  let songStart = 0;
  let scheduledBeat = 0;

  const station = () => (stationIndex === null ? null : STATIONS[stationIndex]);
  // The run row's hold: a held race keeps its kart's speed, so the car falls
  // silent under the pause card while the radio plays on.
  let held = false;

  const noiseBed = (type, freq, q) => {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start();
    return gain;
  };

  const thump = (t, from, vel, out = master) => {
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    const env = ctx.createGain();
    env.gain.setValueAtTime(vel, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.connect(env);
    env.connect(out);
    osc.start(t);
    osc.stop(t + 0.32);
  };

  // Filtered noise: a hit when the filter holds, a whoosh when it sweeps.
  const noise = (t, { type, from, to = from, q = 1, len, attack = 0, vel, out = master }) => {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, t);
    if (to !== from) filter.frequency.exponentialRampToValueAtTime(to, t + len);
    const env = ctx.createGain();
    env.gain.setValueAtTime(attack ? 0.001 : vel, t);
    if (attack) env.gain.linearRampToValueAtTime(vel, t + attack);
    env.gain.exponentialRampToValueAtTime(0.001, t + len);
    src.connect(filter);
    filter.connect(env);
    env.connect(out);
    src.start(t);
    src.stop(t + len + 0.02);
  };

  const arpeggio = (t, notes, step, wave, vel) => {
    notes.forEach((note, i) => {
      const at = t + i * step;
      const osc = ctx.createOscillator();
      osc.type = wave;
      osc.frequency.value = midiHz(note);
      const env = ctx.createGain();
      env.gain.setValueAtTime(vel, at);
      env.gain.exponentialRampToValueAtTime(0.001, at + step * 1.6);
      osc.connect(env);
      env.connect(master);
      osc.start(at);
      osc.stop(at + step * 1.7);
    });
  };
  const voices = { thump, noise, arpeggio };

  const note = (st, ev, t, len) => {
    if (ev.voice === 'kick') return thump(t, 140, ev.vel * 0.9, songBus);
    if (ev.voice === 'snare') return noise(t, { type: 'bandpass', from: 1800, len: 0.15, vel: ev.vel * 0.45, out: songBus });
    if (ev.voice === 'hat') return noise(t, { type: 'highpass', from: 7000, len: 0.05, vel: ev.vel * 0.18, out: songBus });
    const osc = ctx.createOscillator();
    osc.type = ev.voice === 'bass' ? st.bassWave : ev.voice === 'pad' ? 'triangle' : st.leadWave;
    osc.frequency.value = midiHz(ev.note);
    const env = ctx.createGain();
    const peak = { bass: 0.35, pad: 0.05, lead: 0.12 }[ev.voice] * ev.vel;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(peak, t + (ev.voice === 'pad' ? 0.4 : 0.01));
    env.gain.exponentialRampToValueAtTime(0.0001, t + len);
    if (ev.voice === 'lead') {
      // Two-operator FM: a modulator at twice the pitch brightens the tone.
      const mod = ctx.createOscillator();
      mod.frequency.value = midiHz(ev.note) * 2;
      const depth = ctx.createGain();
      depth.gain.value = midiHz(ev.note) * 0.8;
      mod.connect(depth);
      depth.connect(osc.frequency);
      mod.start(t);
      mod.stop(t + len);
    }
    osc.connect(env);
    env.connect(songBus);
    osc.start(t);
    osc.stop(t + len + 0.05);
    return undefined;
  };

  // Each song plays through its own bus, so the notes already queued for the
  // last one (a pad rings for a whole bar) stop with it.
  const restartSong = () => {
    if (!ctx) return;
    if (songBus) songBus.disconnect();
    songBus = ctx.createGain();
    songBus.gain.value = MIX.radio;
    songBus.connect(master);
    songStart = ctx.currentTime;
    scheduledBeat = 0;
  };

  // Queue the station's notes for the next LOOKAHEAD seconds of audio clock.
  // Notes that fell due while nothing ticked (a paused host, a hidden tab) are
  // dropped rather than all started at once.
  const tick = () => {
    const st = station();
    if (!ctx || !st) return;
    const spb = 60 / st.bpm;
    const now = ctx.currentTime - songStart;
    const fromBeat = Math.max(scheduledBeat, (now - LOOKAHEAD) / spb);
    const toBeat = (now + LOOKAHEAD) / spb;
    for (const ev of scheduleStation(st, fromBeat, toBeat)) {
      note(st, ev, songStart + ev.beat * spb, ev.dur * spb);
    }
    scheduledBeat = toBeat;
  };

  const build = () => {
    ctx = createContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : volume;
    analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
    bins = new Uint8Array(analyser.frequencyBinCount);
    const limiter = ctx.createDynamicsCompressor();
    master.connect(limiter);
    limiter.connect(analyser);
    analyser.connect(ctx.destination);

    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    const draw = createPrng(0x5eed);
    for (let i = 0; i < data.length; i++) data[i] = draw() * 2 - 1;

    engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    engineFilter.connect(engineGain);
    engineGain.connect(master);
    engineOscs = [['sawtooth', 1], ['square', 0.5]].map(([type, ratio]) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.connect(engineFilter);
      osc.start();
      return { osc, ratio };
    });

    windGain = noiseBed('bandpass', 600, 0.7);
    tyreGain = noiseBed('bandpass', 2600, 4);
    restartSong();
  };

  const update = (player, driving = true) => {
    if (!ctx) return;
    const t = ctx.currentTime;
    const voice = engineVoice(player);
    for (const { osc, ratio } of engineOscs) osc.frequency.setTargetAtTime(voice.freq * ratio, t, 0.04);
    engineFilter.frequency.setTargetAtTime(voice.cutoff, t, 0.08);
    engineGain.gain.setTargetAtTime(driving && (player.speed > 0 || player.rpm > 1000) ? voice.gain : 0, t, 0.1);
    windGain.gain.setTargetAtTime(driving ? MIX.wind * (player.speed / 300) ** 2 : 0, t, 0.2);
    tyreGain.gain.setTargetAtTime(driving && (player.drift || player.spinTimer > 0) ? 0.22 : 0, t, 0.05);
    tick();
  };
  const handleEvents = (events) => {
    if (!ctx) return;
    for (const ev of events) {
      const cue = CUES[ev.type];
      if (cue) cue(voices, ctx.currentTime);
    }
  };
  const setVolume = (v) => {
    volume = v;
    if (master && !muted) master.gain.value = v;
  };
  const setMuted = (m) => {
    muted = m;
    if (master) master.gain.value = m ? 0 : volume;
  };
  const setStation = (index) => {
    stationIndex = index;
    restartSong();
    return station();
  };

  return {
    get ctx() {
      return ctx;
    },
    get station() {
      return station();
    },
    get stationIndex() {
      return stationIndex;
    },
    get volume() {
      return volume;
    },
    get muted() {
      return muted;
    },
    resume() {
      if (!ctx) build();
      return ctx.resume();
    },
    // Called every committed sim frame with the player's kart; also drives
    // the radio's look-ahead scheduler. A paused race keeps the kart's speed,
    // so the car's own sound follows `driving`, not the kart.
    update,
    // The kinetic child's frame: the seen race's player and cues.
    frame(state) {
      update(state.karts.find((k) => k.isPlayer), !held && (state.stageState === 'racing' || state.stageState === 'checkpoint'));
      if (!held) handleEvents(state.events);
    },
    // The run row's radio and clock, as the kinetic child hands them in.
    props({ station: index, muted: off, volume: level, clock }) {
      held = clock === 'hold';
      const wanted = Number(index) < 0 ? null : Number(index);
      if (wanted !== stationIndex) setStation(wanted);
      if ((off === 'true') !== muted) setMuted(off === 'true');
      if (Number(level) / 100 !== volume) setVolume(Number(level) / 100);
    },
    handleEvents,
    setVolume,
    setMuted,
    setStation,
    // Equalizer bars: the mix's spectrum folded into n bands, each 0..1.
    levels(n = 6) {
      if (!analyser) return Array.from({ length: n }, () => 0);
      analyser.getByteFrequencyData(bins);
      const per = Math.floor(bins.length / n);
      return Array.from({ length: n }, (_, k) => {
        let sum = 0;
        for (let i = k * per; i < (k + 1) * per; i++) sum += bins[i];
        return sum / per / 255;
      });
    },
  };
}
