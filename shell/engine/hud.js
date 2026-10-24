// The HUD's fast half (pronto's kinetic-machine record, "The HUD splits by
// refresh rate"): everything that moves with the frame — speed, revs, the
// clock, the score, the gauges, the radar, the gap to the rival — drawn by the
// presenter into the screen's `<canvas data-layer>`s. The panels around them
// stay the screen's DOM; each layer arrives with the font, colour and glow its
// place in the panel gave it, so the digits look as the spans they replace.
// Numbers print without grouping, as the terminal's locked-down page does.
import { KMH_TO_UNITS_PER_TICK, NITRO_SHOT, OUTRUN_STAGES, nitroStatus } from './simulation.js';

const TACHO = Array.from({ length: 16 }, (_, i) => (i < 6 ? '#10b981' : i < 11 ? '#fbbf24' : i < 14 ? '#ff5e00' : '#ff1e42'));
const EQ = ['#FFB347', '#FF7A59', '#FF4F8B'];
const NITRO = { ready: '#ffd700', boost: '#4de8ff', charging: '#78909c' };

/** The first shadow of a CSS `text-shadow`, as a canvas shadow. */
function glow(textShadow) {
  const m = /(rgba?\([^)]*\)|#[0-9a-f]+)\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px/i.exec(textShadow ?? '');
  return m ? { color: m[1], blur: Number(m[4]) } : null;
}

function prepare(layer) {
  const ctx = layer.canvas.getContext('2d');
  return { layer, ctx, last: null };
}

/** Clears a layer and sets it to CSS pixels. */
function begin(slot) {
  const { layer, ctx } = slot;
  if (layer.canvas.width !== layer.width) layer.canvas.width = layer.width;
  if (layer.canvas.height !== layer.height) layer.canvas.height = layer.height;
  ctx.setTransform(layer.dpr, 0, 0, layer.dpr, 0, 0);
  ctx.clearRect(0, 0, layer.width / layer.dpr, layer.height / layer.dpr);
  return { w: layer.width / layer.dpr, h: layer.height / layer.dpr };
}

/** A line of text in its layer's own style, redrawn only when it changes. */
function text(slot, value, { color, align } = {}) {
  const key = `${value}|${color}`;
  if (slot.last === key) return;
  slot.last = key;
  const { w, h } = begin(slot);
  const { ctx, layer } = slot;
  const { style } = layer;
  ctx.font = style.font;
  ctx.letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
  ctx.fillStyle = color ?? style.color;
  const shadow = glow(style.textShadow);
  ctx.shadowColor = shadow?.color ?? 'transparent';
  ctx.shadowBlur = shadow?.blur ?? 0;
  const side = align ?? (style.textAlign === 'right' || style.textAlign === 'end' ? 'right' : 'left');
  ctx.textAlign = side;
  ctx.textBaseline = 'alphabetic';
  const metrics = ctx.measureText(value);
  const baseline = (h + metrics.fontBoundingBoxAscent - metrics.fontBoundingBoxDescent) / 2;
  ctx.fillText(value, side === 'right' ? w - 1 : 1, baseline);
}

function rounded(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

/** A fill across its track: `paint` is a colour or a gradient's stops. */
function bar(slot, frac, paint, { radius = 3, glowColor = null } = {}) {
  const key = `${frac.toFixed(3)}|${paint}`;
  if (slot.last === key) return;
  slot.last = key;
  const { w, h } = begin(slot);
  const { ctx } = slot;
  if (Array.isArray(paint)) {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    paint.forEach((c, i) => g.addColorStop(i / (paint.length - 1), c));
    ctx.fillStyle = g;
  } else ctx.fillStyle = paint;
  ctx.shadowColor = glowColor ?? 'transparent';
  ctx.shadowBlur = glowColor ? 8 : 0;
  if (frac > 0) rounded(ctx, 0, 0, w * Math.min(1, frac), h, radius);
}

/**
 * The fast HUD over `layers` (env.layers): `draw(state, extra)` paints the
 * player's numbers from the frame's state; `extra.levels` are the mix's
 * equalizer bands, which only the sound seat knows.
 */
export function createHud(layers) {
  const slots = Object.fromEntries(Object.entries(layers).map(([name, layer]) => [name, prepare(layer)]));
  const slot = (name) => slots[name] ?? null;
  return {
    resize(name, measured) {
      const s = slots[name];
      if (!s) return;
      Object.assign(s.layer, measured);
      s.last = null;
    },
    draw(state, { levels = [] } = {}) {
      const player = state.karts?.find((k) => k.isPlayer) ?? state.karts?.[0];
      if (!player) return;
      const spd = Math.round(player.speed || 0);
      const s = slot;
      if (s('speed')) text(s('speed'), String(spd), { align: 'right' });
      const rpm = player.rpm || 1000;
      if (s('rpm')) text(s('rpm'), `${Math.round(rpm)} RPM`, { align: 'right' });
      if (s('tacho')) {
        const lit = Math.round(Math.max(0, Math.min(1, (rpm - 1000) / 8000)) * 16);
        const t = s('tacho');
        if (t.last !== lit) {
          t.last = lit;
          const { w, h } = begin(t);
          const gap = 2;
          const cw = (w - gap * 15) / 16;
          TACHO.forEach((color, i) => {
            t.ctx.globalAlpha = i < lit ? 1 : 0.25;
            t.ctx.fillStyle = color;
            t.ctx.shadowColor = i < lit ? color : 'transparent';
            t.ctx.shadowBlur = i < lit ? (i >= 14 ? 8 : 6) : 0;
            rounded(t.ctx, i * (cw + gap), 0, cw, h, 1);
          });
          t.ctx.globalAlpha = 1;
        }
      }
      const boosting = !!(player.isNitro || player.turboTimer > 0);
      if (s('velo-mode')) {
        const mode = boosting ? 'NITRO BOOST' : spd > 260 ? 'REDLINE' : spd > 20 ? 'CRUISING' : 'IDLE';
        text(s('velo-mode'), mode, { color: boosting ? '#ff0077' : spd > 260 ? '#ff1e42' : '#10b981' });
      }
      if (s('gear')) {
        const g = s('gear');
        const high = player.gear === 'high';
        if (g.last !== high) {
          g.last = high;
          const { w, h } = begin(g);
          const { ctx, layer } = g;
          const half = (w - 2) / 2;
          ['LOW', 'HIGH'].forEach((label, i) => {
            const on = (i === 1) === high;
            const x = i * (half + 2);
            if (on) {
              const grad = ctx.createLinearGradient(x, 0, x + half, 0);
              grad.addColorStop(0, '#ff5e00');
              grad.addColorStop(1, '#ff1e42');
              ctx.fillStyle = grad;
              ctx.shadowColor = 'rgba(255, 94, 0, 0.6)';
              ctx.shadowBlur = 10;
              rounded(ctx, x, 0, half, h, 3);
            }
            ctx.shadowBlur = 0;
            ctx.font = on ? layer.style.font.replace(/\b[1-9]00\b/, '900') : layer.style.font;
            ctx.fillStyle = on ? '#ffffff' : '#78909C';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, x + half / 2, h / 2 + 0.5);
          });
        }
      }
      const nitro = nitroStatus(player);
      if (s('nitro-text')) {
        text(s('nitro-text'), nitro.state === 'boost' ? 'BOOST' : nitro.state === 'charging' ? 'CHARGING' : `NITRO ×${nitro.charges}`, { color: NITRO[nitro.state] });
      }
      if (s('nitro-bar')) {
        const n = s('nitro-bar');
        const key = `${nitro.fill.toFixed(3)}|${nitro.state}`;
        if (n.last !== key) {
          n.last = key;
          const { w, h } = begin(n);
          n.ctx.save();
          n.ctx.beginPath();
          n.ctx.roundRect(0, 0, w, h, 3);
          n.ctx.clip();
          n.ctx.fillStyle = NITRO[nitro.state];
          n.ctx.shadowColor = NITRO[nitro.state];
          n.ctx.shadowBlur = 8;
          n.ctx.fillRect(0, 0, w * nitro.fill, h);
          n.ctx.shadowBlur = 0;
          n.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
          for (const k of [1, 2]) n.ctx.fillRect(w * (NITRO_SHOT / 100) * k, 0, 1, h);
          n.ctx.restore();
        }
      }
      if (s('drift')) text(s('drift'), player.drift ? `DRIFT x${player.driftBonus || 2}` : 'TRACTION 100%');
      const trkLen = state.trackLength || 5000;
      const pz = player.z % trkLen;
      if (s('route-progress')) bar(s('route-progress'), Math.max(0, Math.min(1, pz / trkLen)), ['#00f0ff', '#ffd700', '#ff5e00'], { glowColor: '#ff5e00' });
      const stage = OUTRUN_STAGES[state.stageId];
      const forkZ = stage.fork ? stage.fork.forkSegment * stage.segmentLength : trkLen;
      if (s('fork-dist')) text(s('fork-dist'), `${Math.max(0, Math.round((1 - pz / forkZ) * 100))}% TO FORK`, { align: 'right' });
      if (s('score')) text(s('score'), String(state.score ?? 0), { align: 'right' });
      const rem = Math.max(0, state.timeRemaining || 0);
      if (s('timer')) text(s('timer'), String(Math.floor(rem)), { align: 'right' });
      if (s('timer-dec')) text(s('timer-dec'), `.${Math.floor((rem % 1) * 10)}`);
      if (s('matrix-fork')) {
        if (stage.fork) text(s('matrix-fork'), state.forkActive ? 'FORK APPROACHING!' : `FORK IN ${Math.max(0, Math.round((forkZ - pz) * 0.1))}M`, { color: state.forkActive ? '#00f0ff' : '#ff5e00', align: 'right' });
        else text(s('matrix-fork'), 'DESTINATION', { color: '#ffd700', align: 'right' });
      }
      const ahead = (state.traffic || []).filter((t) => {
        const dz = (t.z % trkLen) - pz;
        return dz > 0 && dz < 450;
      });
      if (s('radar')) {
        if (ahead.length === 0) text(s('radar'), 'CLEAR AHEAD', { align: 'right' });
        else {
          const nearest = ahead.reduce((a, b) => ((b.z % trkLen) < (a.z % trkLen) ? b : a));
          text(s('radar'), `${nearest.type.toUpperCase()} (${Math.round(((nearest.z % trkLen) - pz) * 0.1)}M)`, { align: 'right' });
        }
      }
      if (s('gforce')) text(s('gforce'), Math.abs((player.steerAngle || 0) * (spd / 110)).toFixed(2), { align: 'right' });
      const drafting = ahead.some((t) => (t.z % trkLen) - pz < 120 && Math.abs(t.x - player.x) < 0.28);
      if (s('slipstream')) text(s('slipstream'), `+${drafting ? 18 : player.turboTimer > 0 ? 35 : 0}`, { align: 'right' });
      if (s('draft-status')) text(s('draft-status'), drafting ? 'DRAFT STREAM LOCKED' : ahead.length > 0 ? 'TARGET IN SIGHT' : 'HIGHWAY CLEAR');
      if (s('draft-meter')) {
        const d = s('draft-meter');
        if (d.last !== drafting) {
          d.last = drafting;
          const { h } = begin(d);
          for (let i = 0; i < 4; i++) {
            d.ctx.fillStyle = drafting && i < 3 ? '#00f0ff' : 'rgba(0, 240, 255, 0.2)';
            d.ctx.shadowColor = drafting && i < 3 ? '#00f0ff' : 'transparent';
            d.ctx.shadowBlur = drafting && i < 3 ? 6 : 0;
            rounded(d.ctx, i * 15, 0, 12, h, 1);
          }
        }
      }
      if (s('eq') && levels.length > 0) {
        const e = s('eq');
        const key = levels.map((l) => l.toFixed(2)).join();
        if (e.last !== key) {
          e.last = key;
          const { h } = begin(e);
          levels.forEach((level, i) => {
            const bh = Math.min(h, 2 + level * 32);
            e.ctx.fillStyle = EQ[i % 3];
            rounded(e.ctx, i * 6, h - bh, 4, bh, [1, 1, 0, 0]);
          });
        }
      }
      // The rival: the gap, in seconds at the leader's pace.
      const rival = state.karts.find((k) => k.id === state.rival?.kartId);
      let gapText;
      let fill;
      let split = state.rival?.beaten ? 'BEATEN' : state.rival?.escaped ? 'ESCAPED' : 'IN PURSUIT';
      if (state.duel) {
        const them = state.karts.find((k) => !k.isPlayer);
        const gap = them.z - player.z;
        const pace = Math.max(gap > 0 ? them.speed : player.speed, 30) * KMH_TO_UNITS_PER_TICK * 60;
        split = gap > 0 ? 'AHEAD' : 'BEHIND';
        gapText = `Opponent is ${(Math.abs(gap) / pace).toFixed(1)} s ${gap > 0 ? 'ahead' : 'behind'}`;
        fill = 0.5 + 0.5 * Math.max(-1, Math.min(1, -gap / 3000));
      } else if (rival && state.rival.beaten) {
        gapText = `${rival.name} beaten`;
        fill = 1;
      } else if (rival && state.rival.escaped) {
        gapText = `${rival.name} reached the checkpoint`;
        fill = 0;
      } else if (rival) {
        const gap = Math.max(0, rival.z - player.z);
        gapText = `${rival.name} is ${(gap / (Math.max(rival.speed, 30) * KMH_TO_UNITS_PER_TICK * 60)).toFixed(1)} s ahead`;
        fill = 1 - Math.min(1, gap / 3000);
      }
      if (s('rival-split')) text(s('rival-split'), split, { align: 'right' });
      if (gapText !== undefined && s('rival-gap')) text(s('rival-gap'), gapText);
      if (fill !== undefined && s('rival-fill')) bar(s('rival-fill'), fill, '#FFB347');
    },
  };
}
