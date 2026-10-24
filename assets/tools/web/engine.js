// WebGPU engine with locally vendored shader compilers (9.31.0's versioned CDN path 404s).
window.makeEngine = async (canvas, opts = {}) => {
  const engine = new BABYLON.WebGPUEngine(canvas, { antialias: true, ...opts });
  await engine.initAsync(
    { jsPath: '/web/vendor/glslang.js', wasmPath: '/web/vendor/glslang.wasm' },
    { jsPath: '/web/vendor/twgsl.js', wasmPath: '/web/vendor/twgsl.wasm' });
  return engine;
};
