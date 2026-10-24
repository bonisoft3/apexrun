import { assert, assertEquals } from "jsr:@std/assert@1";
import { brushStrokes, flowerCarpet, frondTexture, waveNormals } from "../shell/engine/scenery.js";

Deno.test("scenery: a frond's leaflets are cut out, not a solid blade", () => {
  const t = frondTexture(128, 32);
  assertEquals(t.pixels.length, 128 * 32 * 4);
  let clear = 0;
  let solid = 0;
  for (let i = 3; i < t.pixels.length; i += 4) {
    if (t.pixels[i] === 0) clear++;
    if (t.pixels[i] === 255) solid++;
  }
  assert(clear > 128 * 32 * 0.25, `gaps between leaflets (${clear})`);
  assert(solid > 128 * 32 * 0.2, `leaflets themselves (${solid})`);
});

Deno.test("scenery: wave normals are unit-ish", () => {
  const w = waveNormals(64, 64, 5);
  for (let i = 0; i < w.pixels.length; i += 4) {
    const [x, y, z] = [w.pixels[i], w.pixels[i + 1], w.pixels[i + 2]].map((c) => c / 127.5 - 1);
    const len = Math.hypot(x, y, z);
    assert(Math.abs(len - 1) < 0.06, `normal ${i / 4} has length ${len}`);
    assert(z > 0.5, "waves face up");
  }
});

// The brush tile is laid in world space on every model, three planes a
// fragment: a seam where it repeats would draw a grid of lines over them.
Deno.test("scenery: the brush stroke tile repeats without a seam and centres on mid-grey", () => {
  const size = 128;
  const { pixels, width, height } = brushStrokes(size, 7);
  assertEquals([width, height], [size, size]);
  const at = (x: number, y: number) => pixels[(y * size + x) * 4];
  let inner = 0;
  let wrapX = 0;
  let wrapY = 0;
  let sum = 0;
  for (let k = 0; k < size; k++) {
    inner += Math.abs(at(60, k) - at(61, k));
    wrapX += Math.abs(at(size - 1, k) - at(0, k));
    wrapY += Math.abs(at(k, size - 1) - at(k, 0));
  }
  for (let i = 0; i < pixels.length; i += 4) sum += pixels[i];
  assert(wrapX < inner * 2 && wrapY < inner * 2, `the edges join as the inside does: ${wrapX}, ${wrapY} against ${inner}`);
  assert(Math.abs(sum / (size * size) - 128) < 8, `mid-grey on average: ${sum / (size * size)}`);
});

// A flower verge read as dots at speed (t31): its carpet is crowded with
// heads, most of the tile flower rather than leaf.
Deno.test("scenery: a flower carpet is mostly flowers", () => {
  const { pixels } = flowerCarpet(128, 3, ["#E8581A"]);
  let flower = 0;
  for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > pixels[i + 1] + 40) flower++;
  assert(flower > 128 * 128 * 0.4, `${flower} flower pixels`);
});
