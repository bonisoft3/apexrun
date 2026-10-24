// The race's frame-timed moments (pronto's kinetic-machine record, "Where it
// stops: slice 7"): the stage card's swoop, the 3-2-1 and GO!, the end's
// GOAL! or TIME OVER before the results, the close-pass and rival banners,
// the stage-clear card over the hand-over and the haze the stage changes
// inside; and over a replay's window (DESIGN.md "End of a run") its own
// titles in place of them: the letterbox, YOUR ROAD TRIP over the first, the
// stage it was cut from over each. Each is a pure function of the frame and
// its window, drawn by the presenter on the screen's `haze` layer (under the
// panels) and `effects` layer (over them), so a replay or a scrub shows the
// same; the cards look as the CSS they replace, sized against the layer as
// that CSS was against the viewport.
import {
  ARCH_LEAD, CHECKPOINT_S, CLOSE_PASS_BANNER_TICKS, COUNTDOWN_TICKS, DEPART_TICKS, END_HOLD_TICKS, OUTRUN_STAGES, RIVAL_POINTS,
} from './simulation.js';

const IMPACT = '"Impact", sans-serif';
const ORBITRON = '"Orbitron", sans-serif';
const clamp = (lo, v, hi) => Math.max(lo, Math.min(hi, v));
const named = (name) => name.replace(/\s*\[.*\]/, '').toUpperCase();
const grouped = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** A layer cleared and set to CSS pixels. */
function begin(layer) {
  const ctx = layer.ctx;
  if (layer.canvas.width !== layer.width) layer.canvas.width = layer.width;
  if (layer.canvas.height !== layer.height) layer.canvas.height = layer.height;
  ctx.setTransform(layer.dpr, 0, 0, layer.dpr, 0, 0);
  const w = layer.width / layer.dpr;
  const h = layer.height / layer.dpr;
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

function panel(ctx, x, y, w, h, { fill, stroke, width = 0, radius = 0, glow = null }) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.fillStyle = fill;
  ctx.shadowColor = glow ?? 'transparent';
  ctx.shadowBlur = glow ? 25 : 0;
  ctx.fill();
  if (stroke) {
    ctx.shadowBlur = 0;
    ctx.lineWidth = width;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
  ctx.restore();
}

function line(ctx, text, x, y, { font, color, spacing = 0, align = 'center', glow = null, drop = null }) {
  ctx.save();
  ctx.font = font;
  ctx.letterSpacing = `${spacing}px`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  if (drop) {
    ctx.fillStyle = drop.color;
    ctx.fillText(text, x + drop.x, y + drop.y);
  }
  ctx.fillStyle = color;
  ctx.shadowColor = glow?.color ?? 'transparent';
  ctx.shadowBlur = glow?.blur ?? 0;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function width(ctx, text, font, spacing) {
  ctx.save();
  ctx.font = font;
  ctx.letterSpacing = `${spacing}px`;
  const measured = ctx.measureText(text).width;
  ctx.restore();
  return measured;
}

// A replay window's titles, in seconds into it: the trip's over the first,
// and the stage's over each, each fading in and out over FADE.
const TRIP_TITLE = [0.2, 2.8];
const STAGE_TITLE = [0.4, 3.4];
const FADE = 0.4;
const shown = (t, [from, to]) => clamp(0, Math.min((t - from) / FADE, (to - t) / FADE), 1);

/** A replay window's frame, as data: its letterbox and titles. */
function replayMoments(state, cut) {
  const t = (state.tick - cut.from) / 60;
  return {
    haze: 0,
    trip: cut.index === 0 ? Math.round(shown(t, TRIP_TITLE) * 20) / 20 : 0,
    stage: { num: state.stageNum, name: named(state.trackName), alpha: Math.round(shown(t, STAGE_TITLE) * 20) / 20 },
    cut: `${cut.index + 1} / ${cut.count}`,
  };
}

/** What the frame shows, as data: equal moments draw once. */
function moments(state) {
  const player = state.karts.find((k) => k.isPlayer) ?? state.karts[0];
  const handover = state.stageState === 'checkpoint';
  const departing = handover && state.departTimer > 0;
  const ended = state.stageState === 'finished' || state.stageState === 'game_over';
  const arriving = handover && !departing ? Math.max(0, 1 - (state.trackLength - player.z) / (ARCH_LEAD * 0.2)) : 0;
  const leaving = departing ? Math.max(0, (state.departTimer - DEPART_TICKS * 0.85) / (DEPART_TICKS * 0.15)) : 0;
  let count = null;
  if (state.countdown > 0 && state.countdown <= COUNTDOWN_TICKS) count = String(Math.ceil(state.countdown / 60));
  else if (state.stageState === 'racing' && state.goTimer > 0) count = 'GO!';
  else if (ended && state.endTicks < END_HOLD_TICKS) count = state.stageState === 'finished' ? 'GOAL!' : 'TIME OVER';
  let clear = null;
  if (handover) {
    const cleared = departing ? state.stageClear : { stageNum: state.stageNum, rival: state.rival.beaten ? 'beaten' : 'ahead' };
    const next = departing ? { num: state.stageNum, name: state.trackName } : { num: state.stageNum + 1, name: OUTRUN_STAGES[state.nextStageId].name };
    clear = { stage: cleared.stageNum, beaten: cleared.rival === 'beaten', next: `NEXT · STAGE ${next.num} · ${named(next.name)}`, skip: departing };
  }
  return {
    haze: Math.max(arriving, leaving) ** 2,
    swoop: state.stageState === 'warmup' && state.countdown > COUNTDOWN_TICKS ? { num: state.stageNum, name: named(state.trackName) } : null,
    count,
    clear,
    pass: state.closePassBannerTimer > 0 ? { bonus: state.closePassBonus, t: (CLOSE_PASS_BANNER_TICKS - state.closePassBannerTimer) / CLOSE_PASS_BANNER_TICKS } : null,
    rival: state.rivalBannerTimer > 0,
  };
}

/** The close pass's pop: its keyframes' offset, scale and opacity at `t`. */
function pop(t) {
  const keys = [[0, 10, 0.7, 0], [0.25, 0, 1.15, 1], [0.7, -2, 1, 1], [1, -10, 0.9, 0]];
  const i = Math.max(0, keys.findIndex(([at]) => at >= t) - 1);
  const [a, b] = [keys[i], keys[Math.min(keys.length - 1, i + 1)]];
  const f = b[0] === a[0] ? 0 : (t - a[0]) / (b[0] - a[0]);
  return { dy: a[1] + (b[1] - a[1]) * f, scale: a[2] + (b[2] - a[2]) * f, alpha: a[3] + (b[3] - a[3]) * f };
}

/**
 * The moments over `layers.haze` and `layers.effects`, either of which a
 * screen may leave out; `draw(state)` repaints only what changed.
 */
export function createEffects(layers) {
  const haze = layers.haze && { ...layers.haze, ctx: layers.haze.canvas.getContext('2d') };
  const over = layers.effects && { ...layers.effects, ctx: layers.effects.canvas.getContext('2d') };
  let lastHaze = null;
  let lastOver = null;
  return {
    resize(name, measured) {
      if (name === 'haze' && haze) {
        Object.assign(haze, measured);
        lastHaze = null;
      }
      if (name === 'effects' && over) {
        Object.assign(over, measured);
        lastOver = null;
      }
    },
    draw(state, cut = null) {
      const m = cut ? replayMoments(state, cut) : moments(state);
      if (haze && m.haze !== lastHaze) {
        lastHaze = m.haze;
        const { ctx, w, h } = begin(haze);
        if (m.haze > 0) {
          // CSS's radial-gradient(ellipse at 50% 45%) to its farthest corner.
          const rx = Math.SQRT2 * w / 2;
          const ry = Math.SQRT2 * h * 0.55;
          ctx.save();
          ctx.globalAlpha = m.haze;
          ctx.translate(w / 2, h * 0.45);
          ctx.scale(1, ry / rx);
          const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
          g.addColorStop(0, '#FFF4E2');
          g.addColorStop(0.7, '#F6D9B4');
          g.addColorStop(1, '#E9BE8E');
          ctx.fillStyle = g;
          ctx.fillRect(-rx, -rx, rx * 2, rx * 2);
          ctx.restore();
        }
      }
      if (!over) return;
      const key = JSON.stringify(cut ? [m.trip, m.stage, m.cut] : [m.swoop, m.count, m.clear, m.pass && [m.pass.bonus, Math.round(m.pass.t * 48)], m.rival]);
      if (key === lastOver) return;
      lastOver = key;
      const { ctx, w, h } = begin(over);
      const vw = w / 100;
      if (cut) {
        const bar = Math.round(h * 0.09);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.92)';
        ctx.fillRect(0, 0, w, bar);
        ctx.fillRect(0, h - bar, w, bar);
        const small = '600 12px system-ui, sans-serif';
        line(ctx, `YOUR ROAD TRIP · ${m.cut}`, 24, bar / 2, { font: small, color: '#C9D2E3', spacing: 2, align: 'left' });
        line(ctx, 'ENTER · SKIP', w - 24, h - bar / 2, { font: small, color: '#90A4AE', spacing: 1.44, align: 'right' });
        if (m.trip > 0) {
          const size = clamp(44, 8 * vw, 96);
          ctx.save();
          ctx.globalAlpha = m.trip;
          line(ctx, 'YOUR ROAD TRIP', w / 2, h * 0.42, {
            font: `900 ${size}px ${IMPACT}`,
            color: '#FFB347',
            spacing: size * 0.06,
            glow: { color: 'rgba(255, 179, 71, 0.7)', blur: 22 },
            drop: { color: 'rgba(0, 0, 0, 0.6)', x: 3, y: 3 },
          });
          ctx.restore();
        }
        if (m.stage.alpha > 0) {
          const top = `${13}px ${IMPACT}`;
          const name = `30px ${IMPACT}`;
          const boxW = Math.max(width(ctx, `STAGE ${m.stage.num}`, top, 3.25), width(ctx, m.stage.name, name, 1.8)) + 40 + 4;
          const boxH = 12 + 16 + 2 + 36 + 12;
          const x = w * 0.05;
          const y = h - bar - boxH - h * 0.05;
          ctx.save();
          ctx.globalAlpha = m.stage.alpha;
          panel(ctx, x, y, boxW, boxH, { fill: 'rgba(12, 16, 24, 0.85)' });
          panel(ctx, x, y, 4, boxH, { fill: '#FFB347' });
          line(ctx, `STAGE ${m.stage.num}`, x + 24, y + 12 + 8, { font: top, color: '#FFB347', spacing: 3.25, align: 'left' });
          line(ctx, m.stage.name, x + 24, y + 12 + 16 + 2 + 18, { font: name, color: '#FFFFFF', spacing: 1.8, align: 'left' });
          ctx.restore();
        }
        return;
      }
      if (m.swoop) {
        const top = `${13}px ${IMPACT}`;
        const name = `30px ${IMPACT}`;
        const boxW = Math.max(width(ctx, `STAGE ${m.swoop.num}`, top, 3.25), width(ctx, m.swoop.name, name, 1.8)) + 40 + 4;
        const boxH = 12 + 16 + 2 + 36 + 12;
        const x = w * 0.94 - boxW;
        const y = h * 0.46;
        panel(ctx, x, y, boxW, boxH, { fill: 'rgba(12, 16, 24, 0.85)' });
        panel(ctx, x, y, 4, boxH, { fill: '#FFB347' });
        line(ctx, `STAGE ${m.swoop.num}`, x + 24, y + 12 + 8, { font: top, color: '#FFB347', spacing: 3.25, align: 'left' });
        line(ctx, m.swoop.name, x + 24, y + 12 + 16 + 2 + 18, { font: name, color: '#FFFFFF', spacing: 1.8, align: 'left' });
      }
      if (m.clear) {
        const kicker = clamp(30, 5 * vw, 52);
        const time = clamp(16, 2.2 * vw, 22);
        const small = clamp(14, 1.8 * vw, 18);
        const rows = [
          { text: `STAGE ${m.clear.stage} CLEAR`, font: `${kicker}px ${IMPACT}`, size: kicker, color: '#7CFF6B', glow: { color: 'rgba(124, 255, 107, 0.6)', blur: 16 } },
          { text: `EXTENDED PLAY +${CHECKPOINT_S} s`, font: `${time}px ${IMPACT}`, size: time * 1.2, color: '#FFD54F' },
          { text: m.clear.beaten ? `RIVAL BEATEN +${grouped(RIVAL_POINTS)}` : 'RIVAL GOT AWAY', font: `${small}px ${IMPACT}`, size: small * 1.2, color: m.clear.beaten ? '#7CFF6B' : '#C9D2E3' },
          { text: m.clear.next, font: `${small}px ${IMPACT}`, size: small * 1.2, color: '#FFB347', gap: 6 },
          ...(m.clear.skip ? [{ text: 'ENTER · TAKE THE WHEEL NOW', font: '600 12px system-ui, sans-serif', size: 15, color: '#90A4AE', spacing: 1.44 }] : []),
        ];
        const inner = Math.max(...rows.map((r) => width(ctx, r.text, r.font, r.spacing ?? r.size * 0.05)));
        const boxW = Math.max(Math.min(440, 86 * vw), inner + 52);
        const boxH = 4 + 18 + 16 + rows.reduce((sum, r) => sum + r.size + (r.gap ?? 0), 0) + 6 * (rows.length - 1);
        const x = w / 2 - boxW / 2;
        const y = h * 0.24;
        panel(ctx, x, y, boxW, boxH, { fill: 'rgba(10, 14, 22, 0.82)', radius: 10 });
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(x, y, boxW, boxH, 10);
        ctx.clip();
        ctx.fillStyle = '#7CFF6B';
        ctx.fillRect(x, y, boxW, 4);
        ctx.restore();
        let at = y + 4 + 18;
        for (const r of rows) {
          at += r.gap ?? 0;
          line(ctx, r.text, w / 2, at + r.size / 2, { font: r.font, color: r.color, spacing: r.spacing ?? r.size * 0.05, glow: r.glow });
          at += r.size + 6;
        }
      }
      if (m.rival) {
        const font = `900 26px ${ORBITRON}`;
        const text = `RIVAL BEATEN +${grouped(RIVAL_POINTS)}`;
        const boxW = width(ctx, text, font, 2.08) + 40 + 4;
        const boxH = 16 + 32 + 4;
        panel(ctx, w / 2 - boxW / 2, h * 0.36 - boxH / 2, boxW, boxH, { fill: 'rgba(10, 25, 47, 0.88)', stroke: '#2BD9A8', width: 2, radius: 8 });
        line(ctx, text, w / 2, h * 0.36, { font, color: '#2BD9A8', spacing: 2.08 });
      }
      if (m.pass) {
        const { dy, scale, alpha } = pop(m.pass.t);
        const font = `900 32px ${ORBITRON}`;
        const text = `+${m.pass.bonus} CLOSE PASS!`;
        const boxW = width(ctx, text, font, 4.8) + 40 + 4;
        const boxH = 12 + 40 + 4;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(w / 2, h * 0.45 + (dy / 100) * boxH);
        ctx.scale(scale, scale);
        panel(ctx, -boxW / 2, -boxH / 2, boxW, boxH, { fill: 'rgba(10, 25, 47, 0.85)', stroke: '#FFD700', width: 2, radius: 8, glow: 'rgba(255, 215, 0, 0.6)' });
        line(ctx, text, 0, 0, { font, color: '#FFD700', spacing: 4.8 });
        ctx.restore();
      }
      if (m.count) {
        const size = clamp(96, 16 * vw, 170);
        line(ctx, m.count, w / 2, h * 0.44, {
          font: `900 ${size}px ${IMPACT}`,
          color: '#FFEB3B',
          glow: { color: 'rgba(255, 235, 59, 0.8)', blur: 24 },
          drop: { color: '#000', x: 4, y: 4 },
        });
      }
    },
  };
}
