// Generated scenery (DESIGN.md "Scenery"): the noise every stage's foliage
// is grown from, and the pixel maps the renderer uploads.
// Pure functions of their seed, so a stage looks the same on every load.

/** The stages driven at night. */
export const NIGHT_STAGES = new Set(['metropolis-night']);

const hash = (n, seed) => {
  let h = Math.imul(n ^ Math.imul(seed, 0x27d4eb2d), 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return ((h >>> 0) / 4294967295) * 2 - 1;
};
const smooth = (t) => t * t * (3 - 2 * t);

/** Two-dimensional value noise that tiles every `period` lattice cells. */
function noise2(x, y, period, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const tx = smooth(x - xi);
  const ty = smooth(y - yi);
  const at = (i, j) => hash(((i % period) + period) % period + (((j % period) + period) % period) * 4099, seed);
  const a = at(xi, yi) * (1 - tx) + at(xi + 1, yi) * tx;
  const b = at(xi, yi + 1) * (1 - tx) + at(xi + 1, yi + 1) * tx;
  return a * (1 - ty) + b * ty;
}

function fbm2(x, y, period, seed, octaves = 4) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const f = 2 ** o;
    sum += noise2(x * f, y * f, period * f, seed + o * 31) * amp;
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

/** A palm frond's leaflets along a midrib, alpha-cut, tapering to the tip. */
export function frondTexture(w, h) {
  const pixels = new Uint8Array(w * h * 4);
  const c = (h - 1) / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / (w - 1);
      const off = Math.abs(y - c) / c;
      const reach = 0.95 * (1 - u ** 1.6) * Math.min(1, u * 6);
      const rib = off < 0.07;
      const leaflet = off < reach && ((x * 0.22 + off * 3.2) % 1) < 0.58;
      const k = (y * w + x) * 4;
      if (rib || leaflet) {
        const shade = 0.75 + 0.25 * (1 - off) - 0.15 * u;
        pixels[k] = Math.round((rib ? 120 : 52) * shade);
        pixels[k + 1] = Math.round((rib ? 110 : 128) * shade);
        pixels[k + 2] = Math.round((rib ? 60 : 50) * shade);
        pixels[k + 3] = 255;
      }
    }
  }
  return { width: w, height: h, pixels };
}

/** A tiling normal map of crossing swells and chop. */
export function waveNormals(w, h, seed) {
  const height = (x, y) =>
    Math.sin((x / w) * Math.PI * 2 * 3 + (y / h) * Math.PI * 2) * 0.5 +
    Math.sin((x / w) * Math.PI * 2 * -2 + (y / h) * Math.PI * 2 * 5) * 0.3 +
    fbm2((x / w) * 8, (y / h) * 8, 8, seed) * 0.35;
  const pixels = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = height(x + 1, y) - height(x - 1, y);
      const dy = height(x, y + 1) - height(x, y - 1);
      const nx = -dx * 2.2;
      const ny = -dy * 2.2;
      const len = Math.hypot(nx, ny, 1);
      const k = (y * w + x) * 4;
      pixels[k] = Math.round((nx / len) * 127.5 + 127.5);
      pixels[k + 1] = Math.round((ny / len) * 127.5 + 127.5);
      pixels[k + 2] = Math.round((1 / len) * 127.5 + 127.5);
      pixels[k + 3] = 255;
    }
  }
  return { width: w, height: h, pixels };
}

/**
 * A `size` x `size` tile of overlapping gouache strokes, grey in RGB around
 * mid-grey: each stroke a slightly bent band with soft tapered ends and
 * bristle streaks along it, lighter or darker than what it covers, laid with
 * wrap-around so the tile repeats without a seam.
 */
export function brushStrokes(size, seed, strokes = 420) {
  let s = seed >>> 0;
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const value = new Float32Array(size * size).fill(0.5);
  for (let n = 0; n < strokes; n++) {
    const cx = rand() * size;
    const cy = rand() * size;
    // Strokes lean toward one hand's direction, as a painter's do.
    const angle = 0.5 + (rand() - 0.5) * 1.6;
    const len = size * (0.12 + 0.22 * rand());
    const width = size * (0.025 + 0.045 * rand());
    const bend = (rand() - 0.5) * 0.5;
    const tone = 0.5 + (rand() < 0.5 ? -1 : 1) * (0.08 + 0.14 * rand());
    const load = 0.55 + 0.4 * rand();
    const bristles = 1.5 + rand() * 2;
    const phase = rand() * 6.283;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    const reach = Math.ceil(len / 2 + width * 2);
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const u = (dx * ca + dy * sa) / len + 0.5;
        if (u < 0 || u > 1) continue;
        const v = (-dx * sa + dy * ca) - bend * (u - 0.5) ** 2 * len * 2;
        const half = width * Math.sqrt(Math.sin(Math.PI * u));
        const across = Math.abs(v) / Math.max(half, 1e-3);
        if (across >= 1) continue;
        const edge = 1 - Math.max(0, across - 0.7) / 0.3;
        const streak = 0.8 + 0.2 * Math.sin((v / width) * bristles * Math.PI + phase);
        // A loaded brush lays most paint at the start and runs dry at the end.
        const a = load * edge * streak * (1 - 0.6 * u ** 2);
        const x = (((Math.floor(cx) + dx) % size) + size) % size;
        const y = (((Math.floor(cy) + dy) % size) + size) % size;
        const i = y * size + x;
        value[i] += (tone - value[i]) * a;
      }
    }
  }
  let mean = 0;
  for (const v of value) mean += v;
  mean /= value.length;
  let dev = 0;
  for (const v of value) dev += (v - mean) ** 2;
  dev = Math.sqrt(dev / value.length);
  const pixels = new Uint8Array(size * size * 4);
  for (let i = 0; i < value.length; i++) {
    const g = Math.round(Math.max(0, Math.min(1, 0.5 + ((value[i] - mean) / dev) * 0.16)) * 255);
    pixels.set([g, g, g, 255], i * 4);
  }
  return { pixels, width: size, height: size };
}

/**
 * A `size` x `size` tile of a painted flower carpet: leaf green under heads
 * crowded edge to edge in `colours` (sRGB hex), each a soft-edged blob lit on
 * its upper left, so a verge reads as one flowering mass; wraps without seam.
 */
export function flowerCarpet(size, seed, colours) {
  let s = seed >>> 0;
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const rgb = colours.map((hex) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16)));
  const leaf = [62, 98, 46];
  const px = new Float32Array(size * size * 3);
  for (let i = 0; i < size * size; i++) px.set(leaf.map((c) => c * (0.8 + 0.3 * rand())), i * 3);
  const heads = Math.round(size * size / 70);
  for (let n = 0; n < heads; n++) {
    const cx = rand() * size;
    const cy = rand() * size;
    const r = size * (0.02 + 0.025 * rand());
    const col = rgb[Math.floor(rand() * rgb.length)].map((c) => c * (0.85 + 0.25 * rand()));
    const reach = Math.ceil(r);
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const d = Math.hypot(dx, dy) / r;
        if (d >= 1) continue;
        const a = Math.min(1, (1 - d) * 3);
        const lit = 0.85 + 0.25 * (-(dx + dy) / (2 * r));
        const x = ((Math.floor(cx) + dx) % size + size) % size;
        const y = ((Math.floor(cy) + dy) % size + size) % size;
        const i = (y * size + x) * 3;
        for (let c = 0; c < 3; c++) px[i + c] += (col[c] * lit - px[i + c]) * a;
      }
    }
  }
  const pixels = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) pixels.set([...px.subarray(i * 3, i * 3 + 3)].map((v) => Math.max(0, Math.min(255, Math.round(v)))).concat(255), i * 4);
  return { pixels, width: size, height: size };
}
