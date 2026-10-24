#!/bin/sh
# Build every id (or those named) in parallel, one process per model -> work/build; logs in work/log/<id>.log
cd "$(dirname "$0")/.."
PY=../assets-pack/.venv/bin/python
mkdir -p work/log
ids="${*:-$($PY -c 'import sys; sys.path.insert(0, "scripts"); import rocks2; print(" ".join(rocks2.MODELS))')}"
for i in $ids; do echo "$i"; done | xargs -P 8 -I{} sh -c "OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 VECLIB_MAXIMUM_THREADS=1 $PY scripts/build.py {} > work/log/{}.log 2>&1 || { echo FAIL {}; tail -5 work/log/{}.log; }"
