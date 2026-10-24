import { assert, assertEquals } from "jsr:@std/assert@1";
import { createSound, engineVoice, scheduleStation, STATIONS, MIX } from "../shell/engine/sound.js";

// A WebAudio stand-in that records the graph it is asked to build.
class FakeParam {
  value = 0;
  events: [string, number, number][] = [];
  setValueAtTime(v: number, t: number) { this.value = v; this.events.push(["set", v, t]); return this; }
  linearRampToValueAtTime(v: number, t: number) { this.value = v; this.events.push(["lin", v, t]); return this; }
  exponentialRampToValueAtTime(v: number, t: number) { this.value = v; this.events.push(["exp", v, t]); return this; }
  setTargetAtTime(v: number, t: number) { this.value = v; this.events.push(["target", v, t]); return this; }
  cancelScheduledValues() { return this; }
}

class FakeNode {
  connections: any[] = [];
  started = 0;
  constructor(public kind: string) {}
  connect(n: any) { this.connections.push(n); return n; }
  disconnect() { this.connections = []; }
  start() { this.started++; }
  stop() {}
}

class FakeContext {
  currentTime = 0;
  sampleRate = 48000;
  state = "running";
  destination = new FakeNode("destination");
  made: FakeNode[] = [];
  private node(kind: string, extra: Record<string, unknown> = {}) {
    const n = Object.assign(new FakeNode(kind), extra);
    this.made.push(n);
    return n as any;
  }
  createGain() { return this.node("gain", { gain: new FakeParam() }); }
  createOscillator() { return this.node("osc", { type: "sine", frequency: new FakeParam(), detune: new FakeParam() }); }
  createBiquadFilter() { return this.node("filter", { type: "lowpass", frequency: new FakeParam(), Q: new FakeParam() }); }
  createBufferSource() { return this.node("source", { buffer: null, loop: false, playbackRate: new FakeParam() }); }
  createBuffer(_c: number, length: number) { return { getChannelData: () => new Float32Array(length) }; }
  createDynamicsCompressor() { return this.node("compressor", { threshold: new FakeParam(), ratio: new FakeParam() }); }
  createAnalyser() {
    return this.node("analyser", {
      fftSize: 0,
      frequencyBinCount: 32,
      getByteFrequencyData(a: Uint8Array) { a.forEach((_, i) => { a[i] = (i * 37) % 256; }); },
    });
  }
  resume() { return Promise.resolve(); }
}

const kinds = (ctx: FakeContext) => ctx.made.map((n) => n.kind);
// The mix's gains, in the order the sound role builds them: the master, the
// engine's, the wind's, the tyres', then each song's bus.
const gains = (ctx: FakeContext) => ctx.made.filter((n) => n.kind === "gain") as any[];
const bus = (ctx: FakeContext) => gains(ctx).filter((g) => g.connections.includes(gains(ctx)[0])).at(-1);
const player = (o: Record<string, unknown> = {}) => ({ speed: 0, rpm: 1000, gear: "low", drift: false, spinTimer: 0, isNitro: false, ...o });

Deno.test("audio: three original stations with distinct tempo and style", () => {
  assertEquals(STATIONS.map((s: any) => `${s.freq} ${s.name}`), ["88.5 Palm Drive", "92.1 Tidal Breeze", "97.3 Neon Surf"]);
  assertEquals(new Set(STATIONS.map((s: any) => s.bpm)).size, 3);
  const sega = /magical|passing|splash|last wave/i;
  for (const s of STATIONS as any[]) assert(!sega.test(s.name), `${s.name} borrows a soundtrack title`);
});

Deno.test("audio: the sequencer is deterministic, stays in its window and loops every four bars", () => {
  for (const station of STATIONS as any[]) {
    const bar = scheduleStation(station, 0, 4);
    assert(bar.length > 0, `${station.name} plays something in its first bar`);
    assert(bar.every((e: any) => e.beat >= 0 && e.beat < 4), `${station.name} leaks past its window`);
    const voices = new Set(scheduleStation(station, 0, 16).map((e: any) => e.voice));
    for (const v of ["kick", "bass", "lead"]) assert(voices.has(v), `${station.name} has no ${v}`);
    const first = scheduleStation(station, 0, 16).map((e: any) => ({ ...e, beat: e.beat }));
    const again = scheduleStation(station, 16, 32).map((e: any) => ({ ...e, beat: e.beat - 16 }));
    assertEquals(again, first, `${station.name} does not loop at four bars`);
    assertEquals(scheduleStation(station, 3, 7), scheduleStation(station, 3, 7));
  }
});

Deno.test("audio: the engine note rises with rpm and opens up with speed", () => {
  const idle = engineVoice(player({ rpm: 1200 }));
  const revving = engineVoice(player({ rpm: 7000, speed: 150 }));
  const flatOut = engineVoice(player({ rpm: 8800, speed: 295, gear: "high" }));
  assert(idle.freq < revving.freq && revving.freq < flatOut.freq, "pitch follows rpm");
  assert(idle.cutoff < revving.cutoff && revving.cutoff <= flatOut.cutoff, "the filter opens with speed");
  assert(idle.gain > 0 && flatOut.gain <= 1, "the level stays in range");
});

Deno.test("audio: nothing is built before the first gesture resumes the context", () => {
  const ctx = new FakeContext();
  const audio = createSound(() => ctx);
  audio.update(player({ speed: 200, rpm: 6000 }));
  audio.handleEvents([{ type: "close-pass" }]);
  assertEquals(ctx.made.length, 0);
  audio.resume();
  assert(kinds(ctx).includes("analyser"), "resume builds the mix with its analyser");
});

Deno.test("audio: the run row's radio picks a station or none, and mutes the whole mix", () => {
  const ctx = new FakeContext();
  const audio = createSound(() => ctx);
  audio.resume();
  assertEquals(audio.station?.name, "Palm Drive");
  audio.props({ station: "2", muted: "false", volume: "70", clock: "play" });
  assertEquals(audio.station?.name, "Neon Surf");
  audio.props({ station: "-1", muted: "false", volume: "70", clock: "play" });
  assertEquals(audio.station, null, "station -1 is the radio off");

  audio.setVolume(0.7);
  audio.setMuted(true);
  assertEquals(gains(ctx)[0].gain.value, 0);
  audio.setMuted(false);
  assertEquals(gains(ctx)[0].gain.value, 0.7);
});

Deno.test("audio: the equalizer reads the live mix as levels between 0 and 1", () => {
  const ctx = new FakeContext();
  const audio = createSound(() => ctx);
  assertEquals(audio.levels(6), [0, 0, 0, 0, 0, 0], "silent before the context exists");
  audio.resume();
  const levels = audio.levels(6);
  assertEquals(levels.length, 6);
  assert(levels.every((l: number) => l >= 0 && l <= 1));
  assert(levels.some((l: number) => l > 0));
});

Deno.test("audio: race events play their cues and the scheduler queues the station's notes", () => {
  const ctx = new FakeContext();
  const audio = createSound(() => ctx);
  audio.resume();
  const before = ctx.made.length;
  audio.handleEvents([{ type: "checkpoint-extended" }, { type: "traffic-collision" }, { type: "close-pass" }]);
  assert(ctx.made.length > before, "cues build voices");

  const queued = ctx.made.length;
  audio.update(player());
  assert(ctx.made.length > queued, "the radio schedules its first notes");
  ctx.currentTime = 0.05;
  const after = ctx.made.length;
  audio.update(player());
  assertEquals(ctx.made.length, after, "notes already queued are not queued again");
});

// A held host or a hidden tab stops the ticks while the audio clock runs on;
// scheduling from the last queued beat would start every missed note at once.
Deno.test("audio: after a stall the radio resumes at the current beat instead of replaying the gap", () => {
  const ctx = new FakeContext();
  const audio = createSound(() => ctx);
  audio.resume();
  audio.update(player());
  ctx.currentTime = 30;
  const before = ctx.made.length;
  audio.update(player());
  const voices = ctx.made.length - before;
  assert(voices < 40, `a 30 s stall queued ${voices} voices`);
});

// A held race keeps its kart's speed, so the kart alone would keep the engine revving under the pause card.
Deno.test("audio: the car falls silent when the race is not being driven", () => {
  const ctx = new FakeContext();
  const audio = createSound(() => ctx);
  audio.resume();
  const [, engine, wind, tyres] = gains(ctx);
  audio.update(player({ speed: 200, rpm: 6000, drift: true }), false);
  assertEquals(engine.gain.value, 0);
  assertEquals(wind.gain.value, 0);
  assertEquals(tyres.gain.value, 0);
  audio.update(player({ speed: 200, rpm: 6000, drift: true }));
  assert(engine.gain.value > 0 && wind.gain.value > 0 && tyres.gain.value > 0);
});

// A pad holds for a whole bar; without its own bus it kept ringing over the next station or "radio off".
Deno.test("audio: changing station cuts the notes queued for the last one", () => {
  const ctx = new FakeContext();
  const audio = createSound(() => ctx);
  audio.resume();
  const last = bus(ctx);
  const before = ctx.made.length;
  audio.update(player());
  const queued = ctx.made.slice(before);
  const intoBus = queued.filter((n) => n.connections.includes(last));
  assert(intoBus.length >= scheduleStation(audio.station, 0, 0.1).length, "every queued voice feeds the song bus");
  assertEquals(queued.filter((n) => n.connections.includes(gains(ctx)[0])).length, 0, "no queued voice bypasses the song bus");
  audio.setStation(1);
  assertEquals(last.connections.length, 0);
  assert(bus(ctx) !== last);
});

// The pause card holds the race on the run row, and the held host commits no
// frame: the car's last frame, heard again while held, would rev on.
Deno.test("audio: a held race silences the car and plays the radio on", () => {
  const ctx = new FakeContext();
  const audio = createSound(() => ctx);
  audio.resume();
  const [, engine] = gains(ctx);
  const racing = { stageState: "racing", events: [], karts: [{ ...player({ speed: 200, rpm: 6000 }), isPlayer: true }] };
  audio.props({ station: "0", muted: "false", volume: "70", clock: "play" });
  audio.frame(racing);
  assert(engine.gain.value > 0);
  audio.props({ station: "0", muted: "false", volume: "70", clock: "hold" });
  const before = ctx.made.length;
  ctx.currentTime = 2;
  audio.frame(racing);
  assertEquals(engine.gain.value, 0);
  assert(ctx.made.length > before, "the radio queues its next notes");
});

// Flat out, the engine nearly matched the radio and its buzz cut through it.
Deno.test("audio: flat out, the engine sits well under the radio", () => {
  const flatOut = engineVoice({ rpm: 9000, speed: 330, gear: "high", isNitro: true });
  assert(flatOut.gain <= MIX.radio / 3, `engine ${flatOut.gain} against radio ${MIX.radio}`);
  assert(MIX.wind <= MIX.radio / 3, "and so does the wind");
});

// The terminal steps the role in an SES compartment endowed with nothing: the
// context is the only authority it holds, and the factory hands it in.
Deno.test("audio: the sound role runs in the terminal's cage on the context it is handed", async () => {
  (0, eval)(await Deno.readTextFile(new URL(import.meta.resolve("/omnishell/interpreter/vendor/ses.umd.min.js"))));
  const { evaluateEngine } = await import("/omnishell/interpreter/jessie.js");
  const graph = JSON.parse(await Deno.readTextFile(new URL("../shell/engines/sound.json", import.meta.url)));
  const caged = await evaluateEngine(graph, "sound");
  const ctx = new FakeContext();
  const audio = caged.createSound(() => ctx);
  audio.resume();
  audio.update(player({ speed: 120, rpm: 5000 }));
  assert(kinds(ctx).includes("analyser"));
  assertEquals(audio.station?.name, "Palm Drive");
});
