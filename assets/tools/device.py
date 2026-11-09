"""The accelerator the asset tools paint and sculpt on: CUDA where there is one
(the RTX 4090 runner), Apple's MPS on a Mac, never the CPU, where a painting job
would take days and look like a hang."""
import torch


def device():
    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    raise SystemExit("no CUDA or MPS device: the asset tools do not run on the CPU")


def synchronize():
    getattr(torch, device()).synchronize()
