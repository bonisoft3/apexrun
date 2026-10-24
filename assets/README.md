# Art pack

The game's sky lighting, textures and models. The bytes are not in git: each file lives in the public bucket `gs://trash-362115-supertuxkart-assets`, named by its sha256, and the `assets` container copies them into the blob store at launch (`services/assets/seed.ts`).

- `manifest.json`: every logical asset (`sky/<stage>.env`, `tex/<set>/<map>`, `model/<id>/lod<n>`) with its file, sha256, size, source, licence and, for skies, the sun to add back as a light.
- `recipes.json`: what made each file: Poly Haven ids and URLs, or the model, revision, prompt, seed and parameters of a generation.
- `tools/`: the scripts that ran (`uv` project, Python 3.12.8) and the headless Babylon pages that prefiltered the skies and rendered the evidence (`pnpm`).

Rebuilding needs an Apple GPU (the scripts run on MPS), about 15 GB of weights, a Hunyuan3D-2 checkout in `HY3D_PATH`, and Babylon's `glslang`/`twgsl` files matching `tools/web/SHA256SUMS` in `tools/web/vendor/`. Uploading a rebuilt pack: `gcloud storage cp -n <files> gs://trash-362115-supertuxkart-assets/`, then commit the new `manifest.json`.
