"""Periodic brush noise for tiling painted textures (numpy only)."""
import numpy as np


def periodic(rng, n, scale):
    """White noise low-passed in the Fourier domain at `scale` px, standardised: periodic, so it tiles."""
    f = np.fft.fftfreq(n)
    k = np.hypot(f[:, None], f[None, :]) * scale
    a = np.real(np.fft.ifft2(np.fft.fft2(rng.standard_normal((n, n))) * np.exp(-0.5 * (k * 2 * np.pi) ** 2)))
    return (a - a.mean()) / a.std()


def stroke_noise(rng, n, length, width, angle):
    """Periodic noise stretched `length` px along `angle` and `width` px across it: brush strokes."""
    f = np.fft.fftfreq(n)
    fx, fy = f[None, :], f[:, None]
    c, s = np.cos(angle), np.sin(angle)
    along, across = fx * c + fy * s, -fx * s + fy * c
    k = np.exp(-0.5 * ((along * length * 2 * np.pi) ** 2 + (across * width * 2 * np.pi) ** 2))
    a = np.real(np.fft.ifft2(np.fft.fft2(rng.standard_normal((n, n))) * k))
    return (a - a.mean()) / a.std()


def strokes(rng, n, length, width, angles=(0.3, 1.35, 2.4), patch=160):
    """Three stroke directions, each owning the patches a broad periodic noise gives it."""
    layers = [stroke_noise(rng, n, length, width, a) for a in angles]
    pick = np.argmax(np.stack([periodic(rng, n, patch) for _ in layers]), 0)
    return np.choose(pick, layers)
