// The renderer as a presenter (program.cue `vendored.renderer`): it paints
// the kinetic host's frames on the canvas its seat transferred, in a worker
// that reaches nothing but that canvas. The art comes through the seat by its
// app path, and Babylon is the pinned script the seat evaluated before this.
import { createEffects } from './effects.js';
import { createHud } from './hud.js';
import { ApexrunRenderer } from './renderer.js';

// A failure after setup is thrown from a task of its own, where it is the
// worker's error and the seat's to banner.
const fail = (err) => setTimeout(() => {
  throw err;
});

export default async function present(canvas, env) {
  const manifest = JSON.parse(new TextDecoder().decode(await env.read('assets/manifest.json')));
  const locate = async (url) => {
    const held = URL.createObjectURL(new Blob([await env.read(url.slice(1))]));
    return { url: held, release: () => URL.revokeObjectURL(held) };
  };
  canvas.width = env.width;
  canvas.height = env.height;
  const renderer = await ApexrunRenderer.create(canvas, null, manifest, { dpr: env.dpr, locate });
  await renderer.calibrateRefresh(requestAnimationFrame);
  const hud = createHud(env.layers);
  const effects = createEffects(env.layers);
  // Each stage's load is asked for once, so a failure is thrown once.
  const asked = new Set();
  return {
    /**
     * A view of the host's frame: its number, its state, the state before it
     * and the alpha between them, and in a replay the window it is cut from.
     * The number goes backwards on a rewind, a seek or a replay, and the
     * renderer keeps only cosmetic state — a camera's easing, a particle's
     * flight — so a jump is at worst a snap.
     */
    frame({ state, prev, alpha, historical, levels, cut = null }) {
      // A stage the host moved to draws once its art has come; until then
      // the last frame stands (ApexrunRenderer.render).
      if (!renderer.art.ready(state.stageId) && !asked.has(state.stageId)) {
        asked.add(state.stageId);
        renderer.art.loadStage(state.stageId).catch(fail);
      }
      renderer.render(state, historical, prev, alpha, cut);
      hud.draw(state, { levels });
      effects.draw(state, cut);
    },
    resizeLayer(name, measured) {
      hud.resize(name, measured);
      effects.resize(name, measured);
    },
    resize(width, height) {
      renderer.resize(width, height);
    },
  };
}
