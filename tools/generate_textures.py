#!/usr/bin/env python3
"""
Procedural & Patch-Synthesis PBR Texture Generator for Monkemon (Three.js r170).
Generates seamless 2048x2048 PBR texture sets (albedo, normal, packed ORM)
and 1024x1024 water normal map on CPU with vectorized NumPy and Pillow.
"""

import argparse
import io
import math
import os
import sys
import time
from PIL import Image, ImageDraw, ImageFont
import numpy as np


# ---------------------------------------------------------------------------
# Utility & Periodic Noise Functions (Exact Toroidal Periodicity)
# ---------------------------------------------------------------------------

def torus_diff(a, b, L=1.0):
    """Shortest signed distance on a 1D periodic torus of length L."""
    return (a - b + 0.5 * L) % L - 0.5 * L


def fft_periodic_noise(N, scale=64.0, power=2.0, highpass_scale=None, seed=None):
    """
    Generate seamless 2D periodic spectral noise on an NxN torus.
    Power law 1 / (1 + (f / f0)^2)^(power/2).
    """
    rng = np.random.default_rng(seed)
    fy = np.fft.fftfreq(N)[:, None]
    fx = np.fft.rfftfreq(N)[None, :]
    freq = np.sqrt(fy**2 + fx**2)
    freq[0, 0] = 1.0 / N

    f0 = 1.0 / max(scale, 1.0)
    amp = 1.0 / (1.0 + (freq / f0)**2)**(power / 2.0)
    amp[0, 0] = 0.0

    if highpass_scale is not None:
        f_hp = 1.0 / max(highpass_scale, 1.0)
        hp_filt = 1.0 - np.exp(-(freq / f_hp)**2)
        amp *= hp_filt

    phase = rng.uniform(0, 2 * np.pi, size=(N, N // 2 + 1))
    spec = amp * np.exp(1j * phase)
    noise = np.fft.irfft2(spec, s=(N, N)).astype(np.float32)

    n_min, n_max = noise.min(), noise.max()
    if n_max > n_min:
        noise = (noise - n_min) / (n_max - n_min)
    else:
        noise.fill(0.5)
    return noise


def periodic_directional_noise(N, scale=32.0, angle_rad=0.0, aspect=4.0, power=2.0, seed=None):
    """
    Anisotropic periodic spectral noise along a given angle on torus.
    """
    rng = np.random.default_rng(seed)
    fy = np.fft.fftfreq(N)[:, None]
    fx = np.fft.rfftfreq(N)[None, :]

    cos_a, sin_a = np.cos(angle_rad), np.sin(angle_rad)
    f_parallel = fx * cos_a + fy * sin_a
    f_perp = -fx * sin_a + fy * cos_a

    freq_eff = np.sqrt((f_parallel * aspect)**2 + f_perp**2)
    freq_eff[0, 0] = 1.0 / N

    f0 = 1.0 / max(scale, 1.0)
    amp = 1.0 / (1.0 + (freq_eff / f0)**2)**(power / 2.0)
    amp[0, 0] = 0.0

    phase = rng.uniform(0, 2 * np.pi, size=(N, N // 2 + 1))
    spec = amp * np.exp(1j * phase)
    noise = np.fft.irfft2(spec, s=(N, N)).astype(np.float32)
    n_min, n_max = noise.min(), noise.max()
    if n_max > n_min:
        return (noise - n_min) / (n_max - n_min)
    return np.full((N, N), 0.5, dtype=np.float32)


def periodic_voronoi(N, K, seed=None):
    """
    Periodic Voronoi on a KxK jittered torus.
    Returns:
      d1: distance to nearest seed (in pixels)
      edge_dist: distance to Voronoi edge (d2 - d1) in pixels
      closest_id: integer ID of closest seed (0 .. K*K - 1)
      centers_y, centers_x: pixel coordinates of each seed (length K*K)
    """
    rng = np.random.default_rng(seed)
    cell_h = N / K
    py = (np.arange(K, dtype=np.float32)[:, None] + 0.10 + 0.80 * rng.random((K, K), dtype=np.float32))
    px = (np.arange(K, dtype=np.float32)[None, :] + 0.10 + 0.80 * rng.random((K, K), dtype=np.float32))
    cell_id = np.arange(K * K, dtype=np.int32).reshape(K, K)

    centers_y = (py * cell_h).ravel()
    centers_x = (px * cell_h).ravel()

    y_1d = np.arange(N, dtype=np.float32) / N
    x_1d = np.arange(N, dtype=np.float32) / N
    y_norm = y_1d[:, None]
    x_norm = x_1d[None, :]

    py_norm = py / K
    px_norm = px / K

    iy = (y_1d * K).astype(np.int32) % K
    ix = (x_1d * K).astype(np.int32) % K

    min_d1 = np.full((N, N), 1e9, dtype=np.float32)
    min_d2 = np.full((N, N), 1e9, dtype=np.float32)
    closest_id = np.zeros((N, N), dtype=np.int32)

    for dy in (-1, 0, 1):
        ny = (iy + dy) % K
        for dx in (-1, 0, 1):
            nx = (ix + dx) % K
            cand_py = py_norm[ny[:, None], nx[None, :]]
            cand_px = px_norm[ny[:, None], nx[None, :]]
            cand_id = cell_id[ny[:, None], nx[None, :]]

            diff_y = torus_diff(cand_py, y_norm, 1.0)
            diff_x = torus_diff(cand_px, x_norm, 1.0)
            d2 = diff_y * diff_y + diff_x * diff_x

            mask = d2 < min_d1
            min_d2 = np.where(mask, min_d1, np.minimum(min_d2, d2))
            min_d1 = np.where(mask, d2, min_d1)
            closest_id = np.where(mask, cand_id, closest_id)

    d1 = np.sqrt(min_d1) * N
    d2 = np.sqrt(min_d2) * N
    edge_dist = np.maximum(0.0, d2 - d1)

    return d1, edge_dist, closest_id, centers_y, centers_x


def splat_patches_native(N, src_img_path, num_patches=1800, min_sz=110, max_sz=180, seed=None):
    """
    Splat randomly rotated patches from 512x512 source onto periodic NxN canvas
    at strict 1:1 source-pixel scale (never magnifying source pixels).
    Uses 3-layer stratified placement on torus ensuring 100% seamless coverage.
    """
    rng = np.random.default_rng(seed)
    src_im = Image.open(src_img_path).convert('RGB')
    src_w, src_h = src_im.size

    accum_rgb = np.zeros((N, N, 3), dtype=np.float32)
    accum_w = np.zeros((N, N, 1), dtype=np.float32)

    grid_steps = int(math.ceil(math.sqrt(num_patches / 3)))
    step = N // grid_steps

    for layer in range(3):
        offset = (step * layer) // 3
        for gy in range(grid_steps):
            for gx in range(grid_steps):
                sz = int(rng.uniform(min_sz, max_sz))
                cy = int((gy * step + offset + rng.uniform(-step * 0.3, step * 0.3)) % N)
                cx = int((gx * step + offset + rng.uniform(-step * 0.3, step * 0.3)) % N)
                rot = float(rng.uniform(0, 360))

                scx = int(rng.integers(0, max(1, src_w - sz)))
                scy = int(rng.integers(0, max(1, src_h - sz)))

                crop = src_im.crop((scx, scy, scx + sz, scy + sz))
                crop = crop.rotate(rot, resample=Image.Resampling.BILINEAR)
                arr = np.array(crop, dtype=np.float32) / 255.0

                y_idx = np.linspace(-1, 1, sz, dtype=np.float32)[:, None]
                x_idx = np.linspace(-1, 1, sz, dtype=np.float32)[None, :]
                r = np.sqrt(y_idx**2 + x_idx**2)
                mask = np.clip(1.0 - r, 0.0, 1.0)
                mask = (np.sin(mask * (np.pi / 2.0)) ** 2)[:, :, None]

                py = (cy - sz // 2 + np.arange(sz)) % N
                px = (cx - sz // 2 + np.arange(sz)) % N

                accum_rgb[py[:, None], px[None, :]] += arr * mask
                accum_w[py[:, None], px[None, :]] += mask

    mask_zero = accum_w < 1e-4
    if np.any(mask_zero):
        mean_col = np.array(src_im.resize((1, 1)), dtype=np.float32).ravel() / 255.0
        accum_rgb[mask_zero.squeeze(-1)] = mean_col
        accum_w[mask_zero] = 1.0

    result = accum_rgb / accum_w
    return np.clip(result, 0.0, 1.0)


def unsharp_mask(arr, sigma=2.0, amount=0.6):
    """Periodic unsharp mask via FFT Gaussian blur."""
    N = arr.shape[0]
    fy = np.fft.fftfreq(N)[:, None]
    fx = np.fft.rfftfreq(N)[None, :]
    filt = np.exp(-2.0 * (np.pi**2) * (sigma**2) * (fy**2 + fx**2))
    if arr.ndim == 3:
        fh = np.fft.rfft2(arr, axes=(0, 1))
        blur = np.fft.irfft2(fh * filt[:, :, None], s=(N, N), axes=(0, 1)).astype(np.float32)
    else:
        fh = np.fft.rfft2(arr)
        blur = np.fft.irfft2(fh * filt, s=(N, N)).astype(np.float32)
    return np.clip(arr + amount * (arr - blur), 0.0, 1.0)


# ---------------------------------------------------------------------------
# PBR Map Derivation (Normal, AO, ORM)
# ---------------------------------------------------------------------------

def normal_from_height(h, strength=2.5):
    """
    Tangent-space normal map (OpenGL convention for Three.js with flipY=true).
    nx = -(h[:, c+1] - h[:, c-1]) * strength
    ny = +(h[r+1, :] - h[r-1, :]) * strength
    nz = 1.0
    Encodes into [0, 255] RGB.
    """
    h_right = np.roll(h, -1, axis=1)
    h_left = np.roll(h, 1, axis=1)
    h_down = np.roll(h, -1, axis=0)
    h_up = np.roll(h, 1, axis=0)

    norm_scale = strength * (h.shape[0] / 2048.0) * 10.0
    nx = -(h_right - h_left) * norm_scale
    ny = +(h_down - h_up) * norm_scale
    nz = np.ones_like(h)

    inv_len = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz)
    nx *= inv_len
    ny *= inv_len
    nz *= inv_len

    rgb = np.stack([nx * 0.5 + 0.5, ny * 0.5 + 0.5, nz * 0.5 + 0.5], axis=-1)
    return (np.clip(rgb, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)


def ao_from_height(h, sigmas=(4.0, 16.0, 64.0)):
    """
    Multi-scale ambient occlusion: height below neighborhood mean.
    Computed via periodic FFT Gaussian blurs. Returns AO in [0.55, 1.0].
    """
    N, M = h.shape
    fy = np.fft.fftfreq(N)[:, None]
    fx = np.fft.rfftfreq(M)[None, :]
    f2 = fy**2 + fx**2

    fh = np.fft.rfft2(h)

    occ_accum = np.zeros_like(h)
    weights = [0.45, 0.35, 0.20]
    scales = [5.0, 3.0, 1.5]

    for sigma, w, scale in zip(sigmas, weights, scales):
        sig_scaled = sigma * (N / 2048.0)
        filt = np.exp(-2.0 * (np.pi ** 2) * (sig_scaled ** 2) * f2)
        blurred = np.fft.irfft2(fh * filt, s=(N, M)).astype(np.float32)
        diff = np.maximum(0.0, blurred - h)
        occ_accum += w * np.clip(diff * scale, 0.0, 1.0)

    ao = 1.0 - occ_accum * 0.45
    return np.clip(ao, 0.55, 1.0)


def create_orm(ao, roughness, height, target_size=1024):
    """
    Pack R=AO, G=Roughness, B=Height into 1024x1024 uint8 RGB.
    """
    def resize_ch(ch):
        if ch.shape[0] != target_size or ch.shape[1] != target_size:
            im = Image.fromarray((np.clip(ch, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8))
            im = im.resize((target_size, target_size), Image.Resampling.BILINEAR)
            return np.array(im, dtype=np.uint8)
        return (np.clip(ch, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)

    r = resize_ch(ao)
    g = resize_ch(roughness)
    b = resize_ch(height)

    return np.stack([r, g, b], axis=-1)


# ---------------------------------------------------------------------------
# JPEG Saving & Verification
# ---------------------------------------------------------------------------

def save_jpeg_target_size(arr, path, start_quality=88, min_quality=74, max_bytes=1.6 * 1024 * 1024):
    """Save image array to JPEG ensuring size <= max_bytes."""
    im = Image.fromarray(arr)
    q = start_quality
    while q >= min_quality:
        buf = io.BytesIO()
        im.save(buf, format='JPEG', quality=q, optimize=True)
        size = len(buf.getvalue())
        if size <= max_bytes or q == min_quality:
            with open(path, 'wb') as f:
                f.write(buf.getvalue())
            return size, q
        q -= 2
    with open(path, 'wb') as f:
        f.write(buf.getvalue())
    return len(buf.getvalue()), q


def seam_check(img_arr):
    """
    Programmatic seam check:
    Computes ratio of wrap-boundary difference vs interior difference.
    Must be <= 1.5 for seamless tiling.
    """
    arr = img_arr.astype(np.float32)
    seam_col = np.abs(arr[:, -1] - arr[:, 0]).mean()
    int_col = np.abs(arr[:, 1:] - arr[:, :-1]).mean()
    col_ratio = seam_col / (int_col + 1e-6)

    seam_row = np.abs(arr[-1, :] - arr[0, :]).mean()
    int_row = np.abs(arr[1:, :] - arr[:-1, :]).mean()
    row_ratio = seam_row / (int_row + 1e-6)

    return float(col_ratio), float(row_ratio)


def make_2x2_tiled_preview(img_arr, preview_size=1024):
    """Generate a 2x2 tiled preview downscaled to preview_size x preview_size."""
    im = Image.fromarray(img_arr)
    half = preview_size // 2
    im_half = im.resize((half, half), Image.Resampling.BILINEAR)
    arr_half = np.array(im_half)
    top = np.concatenate([arr_half, arr_half], axis=1)
    bottom = np.concatenate([arr_half, arr_half], axis=1)
    tiled = np.concatenate([top, bottom], axis=0)
    return Image.fromarray(tiled)


# ---------------------------------------------------------------------------
# Material Generators
# ---------------------------------------------------------------------------

def gen_grass_meadow(N, src_dir, seed=101):
    src_path = os.path.join(src_dir, 'grass_meadow.jpg')
    base = splat_patches_native(N, src_path, num_patches=1800, min_sz=110, max_sz=180, seed=seed)

    # Darker clover / moss patches (~8% coverage)
    n_clover = fft_periodic_noise(N, scale=28.0, power=2.8, seed=seed + 1)
    clover_mask = (n_clover > 0.84)[:, :, None]
    clover_col = np.array([0.22, 0.32, 0.12], dtype=np.float32)

    # Sparse yellow-green highlights (~5% coverage)
    n_high = fft_periodic_noise(N, scale=36.0, power=2.8, seed=seed + 2)
    high_mask = (n_high > 0.90)[:, :, None]
    high_col = np.array([0.42, 0.50, 0.18], dtype=np.float32)

    albedo = base * (~clover_mask) + clover_col * clover_mask
    albedo = albedo * (~high_mask) + high_col * high_mask

    # Overlay thin procedural blade strokes (1-2 px wide, 15-25 px long)
    b1 = periodic_directional_noise(N, scale=18.0, angle_rad=0.35, aspect=7.0, power=1.8, seed=seed + 3)
    b2 = periodic_directional_noise(N, scale=18.0, angle_rad=1.15, aspect=7.0, power=1.8, seed=seed + 4)
    b3 = periodic_directional_noise(N, scale=18.0, angle_rad=2.10, aspect=7.0, power=1.8, seed=seed + 5)
    blades = (b1 + b2 + b3) / 3.0
    blade_mod = 1.0 + (blades[:, :, None] - 0.5) * 0.20
    albedo = np.clip(albedo * blade_mod, 0.0, 1.0)

    # Unsharp mask for crispness
    albedo = unsharp_mask(albedo, sigma=2.0, amount=0.6)

    lum = 0.299 * albedo[:, :, 0] + 0.587 * albedo[:, :, 1] + 0.114 * albedo[:, :, 2]
    height = np.clip(lum * 0.50 + blades * 0.50, 0.0, 1.0)

    normal = normal_from_height(height, strength=2.4)
    ao = ao_from_height(height, sigmas=(4.0, 16.0, 48.0))
    roughness = np.clip(0.80 + (1.0 - height) * 0.10 + (blades - 0.5) * 0.08, 0.65, 0.95)

    return (albedo * 255.0 + 0.5).astype(np.uint8), normal, ao, roughness, height


def gen_grass_grove(N, src_dir, seed=202):
    src_path = os.path.join(src_dir, 'grass_grove.jpg')
    base = splat_patches_native(N, src_path, num_patches=1800, min_sz=110, max_sz=180, seed=seed)

    # Darker, mossier woodland modulation
    n_macro = fft_periodic_noise(N, scale=240.0, power=2.0, seed=seed + 1)
    n_moss = fft_periodic_noise(N, scale=90.0, power=2.2, seed=seed + 2)

    tint = np.ones((N, N, 3), dtype=np.float32)
    tint[:, :, 0] += (n_moss - 0.5) * 0.10 - 0.04
    tint[:, :, 1] += (n_macro - 0.5) * 0.14
    tint[:, :, 2] += (n_moss - 0.5) * 0.06 - 0.05
    albedo = np.clip(base * tint, 0.0, 1.0)

    # Leaf litter & mulch flecks (warm amber-brown dry leaves)
    litter_noise = fft_periodic_noise(N, scale=24.0, power=3.0, seed=seed + 3)
    litter_mask = litter_noise > 0.82
    leaf_col = np.array([0.48, 0.30, 0.16], dtype=np.float32)
    albedo[litter_mask] = albedo[litter_mask] * 0.35 + leaf_col * 0.65

    # Fine grain + unsharp
    rng = np.random.default_rng(seed + 4)
    fine_grain = (rng.uniform(-0.05, 0.05, size=(N, N, 1))).astype(np.float32)
    albedo = np.clip(albedo + fine_grain, 0.0, 1.0)
    albedo = unsharp_mask(albedo, sigma=2.0, amount=0.6)

    lum = 0.299 * albedo[:, :, 0] + 0.587 * albedo[:, :, 1] + 0.114 * albedo[:, :, 2]
    n_uneven = fft_periodic_noise(N, scale=48.0, power=2.0, seed=seed + 5)
    n_detail = fft_periodic_noise(N, scale=10.0, power=1.8, seed=seed + 6)
    height = np.clip(lum * 0.45 + n_uneven * 0.35 + n_detail * 0.20, 0.0, 1.0)

    normal = normal_from_height(height, strength=2.6)
    ao = ao_from_height(height, sigmas=(5.0, 20.0, 60.0))
    roughness = np.clip(0.82 + (n_detail - 0.5) * 0.08 - litter_mask.astype(np.float32) * 0.08, 0.68, 0.96)

    return (albedo * 255.0 + 0.5).astype(np.uint8), normal, ao, roughness, height


def gen_cliff_rock(N, src_dir, seed=303):
    src_path = os.path.join(src_dir, 'cliff_rock.jpg')
    base = splat_patches_native(N, src_path, num_patches=1800, min_sz=110, max_sz=180, seed=seed)

    # Geological strata: natural layered rock ledges
    n_warp = fft_periodic_noise(N, scale=180.0, power=2.2, seed=seed + 1)
    y_coords = np.arange(N, dtype=np.float32)[:, None]
    strata = np.sin((y_coords + (n_warp - 0.5) * 80.0) * (2.0 * np.pi * 8.0 / N)) * 0.5 + 0.5
    n_macro = fft_periodic_noise(N, scale=320.0, power=2.0, seed=seed + 2)

    # Ridged crack lines
    n_ridge = np.abs(fft_periodic_noise(N, scale=24.0, power=1.8, seed=seed + 3) - 0.5) * 2.0
    crack_lines = np.clip((n_ridge - 0.75) * 4.0, 0.0, 1.0)

    # Fine grain noise (+/- 6%)
    rng = np.random.default_rng(seed + 4)
    fine_grain = (rng.uniform(-0.06, 0.06, size=(N, N, 1))).astype(np.float32)

    albedo = base * (0.88 + strata[:, :, None] * 0.16 + (n_macro[:, :, None] - 0.5) * 0.14)
    albedo = albedo * (1.0 - crack_lines[:, :, None] * 0.35) + fine_grain
    albedo = np.clip(albedo, 0.0, 1.0)

    # Unsharp mask for crisp rock edges
    albedo = unsharp_mask(albedo, sigma=2.0, amount=0.6)

    lum = 0.299 * albedo[:, :, 0] + 0.587 * albedo[:, :, 1] + 0.114 * albedo[:, :, 2]
    height = np.clip(lum * 0.55 + strata * 0.25 - crack_lines * 0.25, 0.0, 1.0)

    normal = normal_from_height(height, strength=4.5)
    ao = ao_from_height(height, sigmas=(6.0, 24.0, 72.0))
    roughness = np.clip(0.75 + (1.0 - lum) * 0.15 - crack_lines * 0.15, 0.55, 0.95)

    return (albedo * 255.0 + 0.5).astype(np.uint8), normal, ao, roughness, height


def gen_cobble_path(N, src_dir, seed=404):
    # 18-20 stones across 2048 -> ~108 px stone diameter (target 18-20)
    K = 19
    cell_h = N / K
    rng = np.random.default_rng(seed)

    # Toroidal coordinates with organic domain warp to curve all edges into rounded cobbles
    n_wy = fft_periodic_noise(N, scale=70.0, power=2.2, seed=seed + 10)
    n_wx = fft_periodic_noise(N, scale=70.0, power=2.2, seed=seed + 11)

    y_1d = np.arange(N, dtype=np.float32) / N
    x_1d = np.arange(N, dtype=np.float32) / N
    yw = (y_1d[:, None] + (n_wy - 0.5) * (28.0 / N)) % 1.0
    xw = (x_1d[None, :] + (n_wx - 0.5) * (28.0 / N)) % 1.0

    py = (np.arange(K, dtype=np.float32)[:, None] + 0.15 + 0.70 * rng.random((K, K), dtype=np.float32))
    px = (np.arange(K, dtype=np.float32)[None, :] + 0.15 + 0.70 * rng.random((K, K), dtype=np.float32))
    cell_id = np.arange(K * K, dtype=np.int32).reshape(K, K)

    py_norm = py / K
    px_norm = px / K
    iy = (y_1d * K).astype(np.int32) % K
    ix = (x_1d * K).astype(np.int32) % K

    min_d1 = np.full((N, N), 1e9, dtype=np.float32)
    min_d2 = np.full((N, N), 1e9, dtype=np.float32)
    closest_id = np.zeros((N, N), dtype=np.int32)

    for dy in (-1, 0, 1):
        ny = (iy + dy) % K
        for dx in (-1, 0, 1):
            nx = (ix + dx) % K
            cand_py = py_norm[ny[:, None], nx[None, :]]
            cand_px = px_norm[ny[:, None], nx[None, :]]
            cand_id = cell_id[ny[:, None], nx[None, :]]

            diff_y = torus_diff(cand_py, yw, 1.0)
            diff_x = torus_diff(cand_px, xw, 1.0)
            d2 = diff_y * diff_y + diff_x * diff_x

            mask = d2 < min_d1
            min_d2 = np.where(mask, min_d1, np.minimum(min_d2, d2))
            min_d1 = np.where(mask, d2, min_d1)
            closest_id = np.where(mask, cand_id, closest_id)

    d1 = np.sqrt(min_d1) * N
    d2 = np.sqrt(min_d2) * N
    edge_dist = np.maximum(0.0, d2 - d1)

    # Grout purely from Voronoi difference (d2 - d1 < grout_w) so shapes inflate into rounded pebbles
    grout_w = 9.0
    bevel = 6.0
    stone_mask = np.clip((edge_dist - grout_w) / bevel, 0.0, 1.0)
    stone_mask = stone_mask * stone_mask * (3.0 - 2.0 * stone_mask)

    # Palette restricted strictly to warm tan / cream / ochre / sandy grey (NO pink/violet)
    palettes = np.array([
        [0.76, 0.68, 0.53],  # cream
        [0.71, 0.60, 0.45],  # warm tan
        [0.64, 0.58, 0.50],  # sandy grey
        [0.74, 0.58, 0.36],  # warm ochre
        [0.69, 0.61, 0.47],  # sand tan
        [0.63, 0.51, 0.38],  # dark warm tan
    ], dtype=np.float32)

    num_stones = K * K
    pal_idx = rng.integers(0, len(palettes), size=num_stones)
    stone_base = palettes[pal_idx]
    b_jit = (1.0 + rng.uniform(-0.10, 0.10, size=(num_stones, 1))).astype(np.float32)
    stone_tints = stone_base * b_jit

    # Dome shading: lighter center, ~8% darker towards edge
    max_r = (N / K) * 0.72
    dome = np.sqrt(np.maximum(0.0, 1.0 - (np.clip(d1 / max_r, 0.0, 1.0))**2.0))
    dome_shade = 0.92 + dome * 0.12

    # Visible intra-stone mottling (FBM +/- 7%)
    n_mottle1 = fft_periodic_noise(N, scale=24.0, power=2.0, seed=seed + 1)
    n_mottle2 = fft_periodic_noise(N, scale=12.0, power=1.8, seed=seed + 2)
    mottling = 1.0 + ((n_mottle1 * 0.6 + n_mottle2 * 0.4) - 0.5) * 0.14

    # Stronger fine pore grain (+/- 6%)
    n_pore = fft_periodic_noise(N, scale=4.0, power=1.4, seed=seed + 3)
    pore_grain = 1.0 + (n_pore - 0.5) * 0.12

    # Hairline cracks on ~15% of stones
    has_crack = (rng.random(num_stones) < 0.15).astype(np.float32)
    n_crack = np.abs(fft_periodic_noise(N, scale=28.0, power=2.0, seed=seed + 4) - 0.5) * 2.0
    crack_mask = (n_crack > 0.965).astype(np.float32) * has_crack[closest_id] * stone_mask
    crack_darken = crack_mask * 0.22

    # Lichen flecks (<= 1%)
    n_lichen = fft_periodic_noise(N, scale=10.0, power=3.5, seed=seed + 5)
    lichen_mask = (n_lichen > 0.985) & (stone_mask > 0.8)
    lichen_col = np.array([0.44, 0.52, 0.32], dtype=np.float32)

    stone_col = stone_tints[closest_id] * dome_shade[:, :, None] * mottling[:, :, None] * pore_grain[:, :, None] * (1.0 - crack_darken[:, :, None])
    stone_col[lichen_mask] = lichen_col

    # Sandy grout
    n_sand = fft_periodic_noise(N, scale=5.0, power=1.6, seed=seed + 6)
    grout_rgb = np.array([0.55, 0.48, 0.38], dtype=np.float32) * (0.85 + n_sand[:, :, None] * 0.30)

    albedo = np.clip(stone_col * stone_mask[:, :, None] + grout_rgb * (1.0 - stone_mask[:, :, None]), 0.0, 1.0)
    albedo = unsharp_mask(albedo, sigma=1.5, amount=0.4)

    # Height: dome per stone with pits slightly indented (strength ~4)
    height = np.clip(dome * 0.75 * stone_mask - (1.0 - pore_grain) * 0.10 * stone_mask - crack_mask * 0.15 * stone_mask + 0.15 * (1.0 - stone_mask), 0.0, 1.0)
    normal = normal_from_height(height, strength=4.0)
    ao = ao_from_height(height, sigmas=(4.0, 16.0, 48.0))
    roughness = np.clip(0.64 * stone_mask + 0.88 * (1.0 - stone_mask), 0.50, 0.95)

    return (albedo * 255.0 + 0.5).astype(np.uint8), normal, ao, roughness, height


def gen_harbor_stone(N, src_dir, seed=505):
    rock_path = os.path.join(src_dir, 'cliff_rock.jpg')
    rock_im = Image.open(rock_path).convert('L')
    rock_arr = np.array(rock_im, dtype=np.float32) / 255.0
    H_src, W_src = rock_arr.shape

    R, C = 10, 5
    row_h = N / R  # 204.8
    col_w = N / C  # 409.6

    y_shift = 0.5 * row_h
    x_shift = 0.25 * col_w
    y_grid = ((np.arange(N, dtype=np.float32) + y_shift) % N)[:, None]
    x_grid = ((np.arange(N, dtype=np.float32) + x_shift) % N)[None, :]

    n_chip = fft_periodic_noise(N, scale=16.0, power=1.8, seed=seed + 1)
    n_warp_y = fft_periodic_noise(N, scale=64.0, power=2.2, seed=seed + 2)
    n_warp_x = fft_periodic_noise(N, scale=64.0, power=2.2, seed=seed + 3)

    yw = (y_grid + (n_warp_y - 0.5) * 4.0) % N
    xw = (x_grid + (n_warp_x - 0.5) * 4.0) % N

    u_y = yw / row_h
    dist_y = np.abs(u_y - np.round(u_y)) * row_h
    row_idx = (yw / row_h).astype(np.int32) % R
    row_offset = (row_idx % 2).astype(np.float32) * (col_w * 0.5)

    x_shifted = (xw - row_offset) % N
    u_x = x_shifted / col_w
    dist_x = np.abs(u_x - np.round(u_x)) * col_w

    joint_dist = np.minimum(dist_y, dist_x) + (n_chip - 0.5) * 2.5
    joint_w = 7.0
    bevel_f = np.clip(joint_dist / joint_w, 0.0, 1.0)
    flag_mask = bevel_f * bevel_f * (3.0 - 2.0 * bevel_f)

    # Consistent grey-blue slate palette (hue jitter <= 4 deg, brightness +/- 10%)
    rng = np.random.default_rng(seed + 4)
    num_flags = R * C
    b_jit = (1.0 + rng.uniform(-0.10, 0.10, size=(num_flags, 1))).astype(np.float32)
    r_jit = (1.0 + rng.uniform(-0.02, 0.01, size=(num_flags, 1))).astype(np.float32)
    b_jit2 = (1.0 + rng.uniform(0.00, 0.03, size=(num_flags, 1))).astype(np.float32)
    slate_base = np.array([0.50, 0.52, 0.55], dtype=np.float32)
    flag_tints = slate_base * b_jit * np.concatenate([r_jit, np.ones_like(r_jit), b_jit2], axis=1)

    flag_id = row_idx * C + ((x_shifted / col_w).astype(np.int32) % C)
    src_y_off = rng.integers(0, H_src, size=num_flags).astype(np.float32)
    src_x_off = rng.integers(0, W_src, size=num_flags).astype(np.float32)

    sy = ((src_y_off[flag_id] + y_grid) % H_src).astype(np.int32)
    sx = ((src_x_off[flag_id] + x_grid) % W_src).astype(np.int32)

    # Clean solid rock texture without internal grout lines
    lum = rock_arr[sy, sx]
    lum = (lum - lum.mean()) * 0.55 + 0.50
    n_grain = fft_periodic_noise(N, scale=4.0, power=1.4, seed=seed + 5)
    stone_col = flag_tints[flag_id] * (lum[:, :, None] * 0.50 + 0.75) * (0.95 + n_grain[:, :, None] * 0.10)

    # Grout: darker with sandy grain
    n_sand = fft_periodic_noise(N, scale=6.0, power=1.6, seed=seed + 6)
    grout_col = np.array([0.28, 0.28, 0.29], dtype=np.float32) * (0.85 + n_sand[:, :, None] * 0.30)

    albedo = np.clip(stone_col * flag_mask[:, :, None] + grout_col * (1.0 - flag_mask[:, :, None]), 0.0, 1.0)
    albedo = unsharp_mask(albedo, sigma=2.0, amount=0.6)

    y_in_row = yw % row_h
    x_in_col = x_shifted % col_w
    tilt_y = rng.uniform(-0.03, 0.03, size=num_flags).astype(np.float32)
    tilt_x = rng.uniform(-0.03, 0.03, size=num_flags).astype(np.float32)
    slab_tilt = tilt_y[flag_id] * ((y_in_row - row_h * 0.5) / row_h) + tilt_x[flag_id] * ((x_in_col - col_w * 0.5) / col_w)

    height = np.clip((0.68 + slab_tilt + lum * 0.14 + n_grain * 0.08) * flag_mask + 0.12 * (1.0 - flag_mask), 0.0, 1.0)
    normal = normal_from_height(height, strength=4.0)
    ao = ao_from_height(height, sigmas=(5.0, 20.0, 64.0))
    roughness = np.clip(0.60 * flag_mask + 0.82 * (1.0 - flag_mask) + (n_grain - 0.5) * 0.08, 0.45, 0.92)

    return (albedo * 255.0 + 0.5).astype(np.uint8), normal, ao, roughness, height


def gen_snow_alpine(N, src_dir, seed=606):
    src_path = os.path.join(src_dir, 'snow_alpine.jpg')
    base = splat_patches_native(N, src_path, num_patches=1800, min_sz=110, max_sz=180, seed=seed)

    angle = 30.0 * np.pi / 180.0
    n_dune = periodic_directional_noise(N, scale=90.0, angle_rad=angle, aspect=4.5, power=2.4, seed=seed + 1)
    sastrugi = (np.sin(n_dune * 2.0 * np.pi) * 0.5 + 0.5) ** 1.6

    blue_crevice = np.array([0.70, 0.76, 0.86], dtype=np.float32)
    snow_crest = np.array([0.84, 0.85, 0.87], dtype=np.float32)

    albedo = base * 0.60 + (snow_crest * sastrugi[:, :, None] + blue_crevice * (1.0 - sastrugi[:, :, None])) * 0.40

    rng = np.random.default_rng(seed + 2)
    fine_grain = (rng.uniform(-0.04, 0.04, size=(N, N, 1))).astype(np.float32)
    albedo = np.clip(albedo + fine_grain, 0.0, 1.0)
    albedo = unsharp_mask(albedo, sigma=2.0, amount=0.5)

    n_crystal = fft_periodic_noise(N, scale=6.0, power=1.5, seed=seed + 3)
    height = np.clip(sastrugi * 0.65 + n_crystal * 0.35, 0.0, 1.0)

    normal = normal_from_height(height, strength=2.0)
    ao = ao_from_height(height, sigmas=(6.0, 24.0, 72.0))

    sparkle_mask = fft_periodic_noise(N, scale=4.0, power=1.4, seed=seed + 4) > 0.97
    roughness = np.full((N, N), 0.55, dtype=np.float32)
    roughness += (n_crystal - 0.5) * 0.10
    roughness[sparkle_mask] = 0.28
    roughness = np.clip(roughness, 0.25, 0.75)

    return (albedo * 255.0 + 0.5).astype(np.uint8), normal, ao, roughness, height


def gen_volcano_basalt(N, src_dir, seed=707):
    src_path = os.path.join(src_dir, 'volcano_basalt.jpg')
    base = splat_patches_native(N, src_path, num_patches=1800, min_sz=110, max_sz=180, seed=seed)

    # Voronoi crust plates
    _, edge_dist, _, _, _ = periodic_voronoi(N, K=24, seed=seed + 1)
    n_warp = fft_periodic_noise(N, scale=48.0, power=2.0, seed=seed + 2)
    warped_edge = edge_dist + (n_warp - 0.5) * 16.0
    crack_w = 14.0
    crack_mask = np.clip(1.0 - warped_edge / crack_w, 0.0, 1.0) ** 1.8

    # Subtle orange/red lava glow in deep fissures
    n_hotspot = fft_periodic_noise(N, scale=120.0, power=2.2, seed=seed + 3)
    glow_strength = crack_mask * np.clip((n_hotspot - 0.35) * 2.2, 0.0, 1.0)
    lava_glow = np.array([1.0, 0.38, 0.05], dtype=np.float32)

    rng = np.random.default_rng(seed + 4)
    fine_grain = (rng.uniform(-0.05, 0.05, size=(N, N, 1))).astype(np.float32)

    albedo = base * (1.0 - crack_mask[:, :, None] * 0.65)
    albedo = albedo * (1.0 - glow_strength[:, :, None]) + lava_glow * (glow_strength[:, :, None] * 0.75) + fine_grain
    albedo = np.clip(albedo, 0.0, 1.0)
    albedo = unsharp_mask(albedo, sigma=2.0, amount=0.6)

    lum = 0.299 * albedo[:, :, 0] + 0.587 * albedo[:, :, 1] + 0.114 * albedo[:, :, 2]
    n_porous = fft_periodic_noise(N, scale=8.0, power=1.6, seed=seed + 5)
    height = np.clip((0.75 - crack_mask * 0.65) + lum * 0.15 + n_porous * 0.10, 0.0, 1.0)

    normal = normal_from_height(height, strength=4.2)
    ao = ao_from_height(height, sigmas=(5.0, 20.0, 60.0))
    roughness = np.clip(0.72 * (1.0 - crack_mask) + 0.38 * glow_strength + (n_porous - 0.5) * 0.10, 0.32, 0.92)

    return (albedo * 255.0 + 0.5).astype(np.uint8), normal, ao, roughness, height


def gen_wood_timber(N, src_dir, seed=808):
    src_path = os.path.join(src_dir, 'wood_timber.jpg')
    src_im = Image.open(src_path).convert('RGB')
    src = np.array(src_im, dtype=np.float32) / 255.0
    H_src, W_src, _ = src.shape

    num_planks = 8
    plank_h = N / num_planks

    y_shift = 0.5 * plank_h
    y_grid = ((np.arange(N, dtype=np.float32) + y_shift) % N)[:, None]
    x_grid = np.arange(N, dtype=np.float32)[None, :]

    plank_row = (y_grid / plank_h).astype(np.int32) % num_planks
    u_y = y_grid / plank_h
    dist_h = np.abs(u_y - np.round(u_y)) * plank_h

    rng = np.random.default_rng(seed)
    joint_cuts = [
        [0.35 * N, 0.75 * N],
        [0.15 * N, 0.60 * N],
        [0.45 * N, 0.85 * N],
        [0.25 * N, 0.70 * N],
        [0.50 * N],
        [0.20 * N, 0.65 * N],
        [0.40 * N, 0.80 * N],
        [0.18 * N, 0.58 * N],
    ]

    groove_w = 6.0
    groove_mask = np.clip(dist_h / groove_w, 0.0, 1.0)
    groove_mask = groove_mask * groove_mask * (3.0 - 2.0 * groove_mask)

    dist_v = np.full((N, N), 1e5, dtype=np.float32)
    plank_row_1d = plank_row.squeeze(-1)
    for r in range(num_planks):
        r_mask = (plank_row_1d == r)
        min_cut = np.full((1, N), 1e5, dtype=np.float32)
        for cut in joint_cuts[r]:
            dx = np.abs(torus_diff(x_grid, cut, N))
            min_cut = np.minimum(min_cut, dx)
        dist_v[r_mask, :] = min_cut

    end_joint_w = 4.0
    end_mask = np.clip(dist_v / end_joint_w, 0.0, 1.0)
    end_mask = end_mask * end_mask * (3.0 - 2.0 * end_mask)
    plank_mask = groove_mask * end_mask

    n_warp = fft_periodic_noise(N, scale=140.0, power=2.2, seed=seed + 1)
    grain_y = (y_grid + (n_warp - 0.5) * 35.0) * (2.0 * np.pi * 32.0 / N)
    wood_grain = np.sin(grain_y) * 0.5 + 0.5

    plank_tints = (1.0 + rng.uniform(-0.08, 0.08, size=(num_planks, 3))).astype(np.float32)
    src_y_off = rng.integers(0, H_src, size=num_planks).astype(np.float32)
    src_x_off = rng.integers(0, W_src, size=num_planks).astype(np.float32)

    sy = ((src_y_off[plank_row] + y_grid) % H_src).astype(np.int32)
    sx = ((src_x_off[plank_row] + x_grid) % W_src).astype(np.int32)
    wood_base = src[sy, sx] * plank_tints[plank_row]

    groove_col = np.array([0.22, 0.15, 0.10], dtype=np.float32)
    albedo = wood_base * (0.88 + wood_grain[:, :, None] * 0.24)
    albedo = np.clip(albedo * plank_mask[:, :, None] + groove_col * (1.0 - plank_mask[:, :, None]), 0.0, 1.0)
    albedo = unsharp_mask(albedo, sigma=2.0, amount=0.5)

    y_in_plank = y_grid % plank_h
    crown = np.sin((y_in_plank / plank_h) * np.pi) ** 0.5
    lum = 0.299 * albedo[:, :, 0] + 0.587 * albedo[:, :, 1] + 0.114 * albedo[:, :, 2]
    height = np.clip((crown * 0.60 + wood_grain * 0.25 + lum * 0.15) * plank_mask + 0.12 * (1.0 - plank_mask), 0.0, 1.0)

    normal = normal_from_height(height, strength=3.4)
    ao = ao_from_height(height, sigmas=(5.0, 18.0, 54.0))
    roughness = np.clip(0.60 * plank_mask + 0.85 * (1.0 - plank_mask) + (wood_grain - 0.5) * 0.08, 0.45, 0.92)

    return (albedo * 255.0 + 0.5).astype(np.uint8), normal, ao, roughness, height


def gen_sand_beach(N, seed=909):
    # Light golden sand overall (no heavy dark shadows)
    base_sand = np.array([0.78, 0.69, 0.50], dtype=np.float32)

    # 32 wind-ripple ridges across 2048 (wavelength ~64 px)
    n_warp = fft_periodic_noise(N, scale=120.0, power=2.2, seed=seed + 1)
    y_coord = np.arange(N, dtype=np.float32)[:, None]
    x_coord = np.arange(N, dtype=np.float32)[None, :]

    kx, ky = 28.0, 12.0  # Harmonic frequency vector for exact toroidal wrap
    phase = (kx * x_coord + ky * y_coord) * (2.0 * np.pi / N) + (n_warp - 0.5) * 8.0
    ripples = (np.sin(phase) * 0.5 + 0.5) ** 1.8

    # Per-pixel fine sand grain (+/- 8%)
    rng = np.random.default_rng(seed + 2)
    fine_grain = (rng.uniform(-0.08, 0.08, size=(N, N, 1))).astype(np.float32)

    # Scattered Worley pebbles & shell flecks (clustered, ~1-3% coverage)
    d1_peb, _, _, _, _ = periodic_voronoi(N, K=32, seed=seed + 3)
    n_cluster = fft_periodic_noise(N, scale=40.0, power=2.0, seed=seed + 4)
    peb_mask = (d1_peb < 4.0) & (n_cluster > 0.82)
    shell_mask = (d1_peb < 2.2) & (n_cluster > 0.90)

    peb_col = np.array([0.55, 0.48, 0.40], dtype=np.float32)
    shell_col = np.array([0.95, 0.92, 0.88], dtype=np.float32)

    # Subtle damp patches (very soft +/- 4%)
    n_damp = fft_periodic_noise(N, scale=280.0, power=2.0, seed=seed + 5)
    damp = 1.0 + (n_damp[:, :, None] - 0.5) * 0.08
    ripple_tint = 0.96 + ripples[:, :, None] * 0.08

    albedo = base_sand * damp * ripple_tint + fine_grain
    albedo[peb_mask] = peb_col
    albedo[shell_mask] = shell_col
    albedo = np.clip(albedo, 0.0, 1.0)
    albedo = unsharp_mask(albedo, sigma=1.5, amount=0.4)

    # Height: crisp wind ripples + sand grain + pebble bumps
    height = np.clip(ripples * 0.65 + (fine_grain.squeeze(-1) + 0.08) * 0.45 + peb_mask.astype(np.float32) * 0.25, 0.0, 1.0)
    normal = normal_from_height(height, strength=2.8)
    ao = ao_from_height(height, sigmas=(4.0, 16.0, 50.0))
    roughness = np.clip(0.85 - ripples * 0.15 + fine_grain.squeeze(-1) * 0.5, 0.55, 0.95)
    roughness[shell_mask] = 0.32

    return (albedo * 255.0 + 0.5).astype(np.uint8), normal, ao, roughness, height


def gen_dirt_path(N, src_dir='tools/texture_sources', seed=1010):
    # Rich earthy loam
    base_dirt = np.array([0.48, 0.38, 0.27], dtype=np.float32)

    # +/- 10% low-frequency wet/dry patches
    n_wet = fft_periodic_noise(N, scale=280.0, power=2.0, seed=seed)
    n_dry = fft_periodic_noise(N, scale=120.0, power=2.2, seed=seed + 1)
    wet_dry = 1.0 + (n_wet - 0.5) * 0.16 + (n_dry - 0.5) * 0.12

    # Soil crumb & fine grain
    n_crumb = fft_periodic_noise(N, scale=8.0, power=1.8, seed=seed + 2)
    n_fine_soil = (fft_periodic_noise(N, scale=3.0, power=1.4, seed=seed + 3) - 0.5) * 0.12

    # Small embedded pebbles: 4-10 px, noise-perturbed discs, muted grey-tan, half-embedded
    d1_peb, _, _, _, _ = periodic_voronoi(N, K=56, seed=seed + 4)
    n_noise_disc = fft_periodic_noise(N, scale=8.0, power=1.6, seed=seed + 5)
    d_pert = d1_peb + (n_noise_disc - 0.5) * 2.5

    n_peb_clust = fft_periodic_noise(N, scale=40.0, power=2.0, seed=seed + 6)
    n_peb_sz = fft_periodic_noise(N, scale=10.0, power=2.0, seed=seed + 7)
    peb_r = 2.5 + n_peb_sz * 2.5  # radius 2.5 to 5.0 px (diameter 5 to 10 px)
    peb_mask = (d_pert < peb_r) & (n_peb_clust > 0.55)  # 1-3% coverage

    # Pebble dome & socket rim
    peb_dome = np.sqrt(np.maximum(0.0, 1.0 - (d_pert / np.maximum(peb_r, 1e-4))**2.0)) * peb_mask.astype(np.float32)
    # Soft dark rim around embedded pebble
    rim_mask = np.clip(1.0 - np.abs(d_pert - (peb_r + 1.2)) / 1.5, 0.0, 1.0) * (n_peb_clust > 0.55).astype(np.float32)

    # Muted grey-tan pebble color
    n_peb_col = fft_periodic_noise(N, scale=6.0, power=1.8, seed=seed + 8)
    peb_base = np.array([0.56, 0.50, 0.42], dtype=np.float32)
    peb_col = peb_base * (0.85 + n_peb_col[:, :, None] * 0.30) * (0.88 + peb_dome[:, :, None] * 0.24)

    # Darker root/mulch streaks (thin warped curving lines)
    n_root_warp1 = fft_periodic_noise(N, scale=90.0, power=2.2, seed=seed + 9)
    n_root_warp2 = fft_periodic_noise(N, scale=90.0, power=2.2, seed=seed + 10)
    y_coord = np.arange(N, dtype=np.float32)[:, None]
    x_coord = np.arange(N, dtype=np.float32)[None, :]

    coord1 = (y_coord + (n_root_warp1 - 0.5) * 60.0 + x_coord * 0.35) * (2.0 * np.pi * 3.0 / N)
    streak1 = np.clip(1.0 - np.abs(np.sin(coord1)) * 32.0, 0.0, 1.0) * (fft_periodic_noise(N, scale=32.0, seed=seed + 11) > 0.65)

    coord2 = (x_coord + (n_root_warp2 - 0.5) * 60.0 - y_coord * 0.25) * (2.0 * np.pi * 3.0 / N)
    streak2 = np.clip(1.0 - np.abs(np.sin(coord2)) * 32.0, 0.0, 1.0) * (fft_periodic_noise(N, scale=32.0, seed=seed + 12) > 0.65)

    root_streaks = np.maximum(streak1, streak2)
    mulch_col = np.array([0.22, 0.15, 0.10], dtype=np.float32)

    # Earth albedo
    albedo = base_dirt * wet_dry[:, :, None] * (0.88 + n_crumb[:, :, None] * 0.24) + n_fine_soil[:, :, None]
    albedo = albedo * (1.0 - root_streaks[:, :, None] * 0.45) + mulch_col * (root_streaks[:, :, None] * 0.45)
    # Socket rim darkening around pebbles
    albedo = albedo * (1.0 - rim_mask[:, :, None] * 0.30)
    albedo[peb_mask] = peb_col[peb_mask]
    albedo = np.clip(albedo, 0.0, 1.0)
    albedo = unsharp_mask(albedo, sigma=1.5, amount=0.4)

    height = np.clip(wet_dry * 0.25 + n_crumb * 0.20 + peb_dome * 0.45 + root_streaks * 0.15, 0.0, 1.0)
    normal = normal_from_height(height, strength=3.4)
    ao = ao_from_height(height, sigmas=(5.0, 18.0, 54.0))
    roughness = np.clip(0.80 + (n_crumb - 0.5) * 0.10 - peb_dome * 0.35, 0.55, 0.95)

    return (albedo * 255.0 + 0.5).astype(np.uint8), normal, ao, roughness, height


def gen_water_normal(N=1024, seed=1212):
    """
    Seamless ocean ripple normals:
    Sum of 14 directional Gerstner-like waves with integer wave vectors (exact tiling),
    plus fine FBM capillary ripple layer.
    """
    rng = np.random.default_rng(seed)
    y, x = np.ogrid[:N, :N]
    y = y.astype(np.float32) / N
    x = x.astype(np.float32) / N

    h = np.zeros((N, N), dtype=np.float32)

    harmonics = [
        (1, 3), (2, -2), (3, 4), (-4, 2), (5, 5), (-3, 6),
        (7, -2), (6, 8), (-8, 5), (10, 3), (9, -9), (12, 6),
        (15, -10), (18, 14)
    ]

    for mx, my in harmonics:
        k = math.sqrt(mx * mx + my * my)
        amp = 1.0 / (k ** 1.25)
        phase = rng.uniform(0, 2 * np.pi)
        theta = 2.0 * np.pi * (mx * x + my * y) + phase
        wave = np.exp(np.sin(theta) - 1.0)
        h += wave * amp

    for _ in range(10):
        mx = rng.integers(-40, 41)
        my = rng.integers(-40, 41)
        if mx == 0 and my == 0:
            continue
        k = math.sqrt(mx * mx + my * my)
        amp = 0.25 / (k ** 1.15)
        phase = rng.uniform(0, 2 * np.pi)
        theta = 2.0 * np.pi * (mx * x + my * y) + phase
        h += np.sin(theta) * amp

    strength = 1.35 * (N / 1024.0) * 12.0
    h_right = np.roll(h, -1, axis=1)
    h_left = np.roll(h, 1, axis=1)
    h_down = np.roll(h, -1, axis=0)
    h_up = np.roll(h, 1, axis=0)

    nx = -(h_right - h_left) * strength
    ny = +(h_down - h_up) * strength
    nz = np.ones_like(h)

    inv_len = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz)
    nx *= inv_len
    ny *= inv_len
    nz *= inv_len

    rgb = np.stack([nx * 0.5 + 0.5, ny * 0.5 + 0.5, nz * 0.5 + 0.5], axis=-1)
    return (np.clip(rgb, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)


# ---------------------------------------------------------------------------
# Contact Sheet Generator
# ---------------------------------------------------------------------------

def generate_contact_sheet(albedo_crops, normal_crops, output_path):
    """
    Generate labeled contact sheet containing top-left 512x512 crops of
    every albedo and normal map side-by-side.
    Layout: 11 rows (one per material), 2 columns (Albedo, Normal).
    """
    tile_sz = 512
    banner_h = 32
    row_h = tile_sz + banner_h
    col_w = tile_sz
    pad = 16

    num_mats = len(albedo_crops)
    sheet_w = pad + 2 * (col_w + pad)
    sheet_h = pad + num_mats * (row_h + pad)

    sheet = Image.new('RGB', (sheet_w, sheet_h), (24, 24, 28))
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()

    for idx, (mat_name, alb_im, norm_im) in enumerate(zip(albedo_crops.keys(), albedo_crops.values(), normal_crops.values())):
        y_top = pad + idx * (row_h + pad)

        # Draw Albedo Tile
        x_alb = pad
        draw.rectangle([x_alb, y_top, x_alb + col_w, y_top + banner_h], fill=(45, 45, 52))
        draw.text((x_alb + 8, y_top + 10), f'{mat_name} (Albedo 512² native crop)', fill=(240, 240, 240), font=font)
        if alb_im is not None:
            sheet.paste(alb_im, (x_alb, y_top + banner_h))

        # Draw Normal Tile
        x_norm = pad + col_w + pad
        draw.rectangle([x_norm, y_top, x_norm + col_w, y_top + banner_h], fill=(45, 45, 52))
        draw.text((x_norm + 8, y_top + 10), f'{mat_name}_normal (Normal 512² native crop)', fill=(240, 240, 240), font=font)
        if norm_im is not None:
            sheet.paste(norm_im, (x_norm, y_top + banner_h))

    sheet.save(output_path, format='JPEG', quality=90)
    print(f'Contact sheet saved: {output_path} ({os.path.getsize(output_path) / 1024 / 1024:.2f} MB)')


# ---------------------------------------------------------------------------
# Main Orchestrator
# ---------------------------------------------------------------------------

MATERIALS = [
    'grass_meadow',
    'grass_grove',
    'cliff_rock',
    'cobble_path',
    'harbor_stone',
    'snow_alpine',
    'volcano_basalt',
    'wood_timber',
    'sand_beach',
    'dirt_path',
    'water_normal',
]


def main():
    parser = argparse.ArgumentParser(description='PBR Texture Generator for Monkemon')
    parser.add_argument('--size', type=int, default=2048, help='Resolution for ground textures (default: 2048)')
    parser.add_argument('--only', type=str, default=None, help='Comma-separated list of materials to generate')
    parser.add_argument('--output_dir', type=str, default='assets/textures', help='Output directory for textures')
    parser.add_argument('--sources_dir', type=str, default='tools/texture_sources', help='Directory with 512x512 sources')
    parser.add_argument('--preview_dir', type=str,
                        default='/usr/local/google/home/junius/.gemini/jetski/brain/34616a9d-8c3e-44bc-9b96-acf6408e4756/scratch/textures',
                        help='Scratch directory for 2x2 tiled previews')
    args = parser.parse_args()

    selected = MATERIALS
    if args.only:
        req = [m.strip() for m in args.only.split(',') if m.strip()]
        selected = [m for m in req if m in MATERIALS]
        if not selected:
            print(f'Error: No valid materials specified in --only. Available: {MATERIALS}')
            sys.exit(1)

    os.makedirs(args.output_dir, exist_ok=True)
    os.makedirs(args.preview_dir, exist_ok=True)

    print(f'=== Monkemon PBR Texture Generator (v2 Native Quality) ===')
    print(f'Output dir:  {args.output_dir}')
    print(f'Sources dir: {args.sources_dir}')
    print(f'Preview dir: {args.preview_dir}')
    print(f'Ground resolution: {args.size}x{args.size}')
    print(f'Materials ({len(selected)}): {", ".join(selected)}')
    print('==========================================================')

    t_start = time.time()
    results = []
    seam_results = []
    albedo_512_crops = {}
    normal_512_crops = {}

    for mat in selected:
        t0 = time.time()
        print(f'\nGenerating material: [{mat}] ...', flush=True)

        if mat == 'water_normal':
            w_norm = gen_water_normal(N=1024, seed=1212)
            norm_path = os.path.join(args.output_dir, 'water_normal.jpg')
            size_norm, q_norm = save_jpeg_target_size(w_norm, norm_path, start_quality=92, max_bytes=1.5 * 1024 * 1024)
            results.append((norm_path, size_norm, '1024x1024', q_norm))

            # Seam check
            c_r, r_r = seam_check(w_norm)
            seam_results.append(('water_normal.jpg', c_r, r_r, 'PASS' if c_r <= 1.5 and r_r <= 1.5 else 'FAIL'))

            # Preview
            prev_im = make_2x2_tiled_preview(w_norm, preview_size=1024)
            prev_path = os.path.join(args.preview_dir, 'water_normal_preview.jpg')
            prev_im.save(prev_path, format='JPEG', quality=88)

            # Crops for contact sheet
            albedo_512_crops[mat] = None
            normal_512_crops[mat] = Image.fromarray(w_norm[:512, :512])

            print(f'  ✓ water_normal.jpg saved ({size_norm/1024:.1f} KB, q={q_norm}) in {time.time()-t0:.2f}s')
            continue

        # Standard ground PBR material
        N = args.size
        if mat == 'grass_meadow':
            albedo, normal, ao, roughness, height = gen_grass_meadow(N, args.sources_dir)
        elif mat == 'grass_grove':
            albedo, normal, ao, roughness, height = gen_grass_grove(N, args.sources_dir)
        elif mat == 'cliff_rock':
            albedo, normal, ao, roughness, height = gen_cliff_rock(N, args.sources_dir)
        elif mat == 'cobble_path':
            albedo, normal, ao, roughness, height = gen_cobble_path(N, args.sources_dir)
        elif mat == 'harbor_stone':
            albedo, normal, ao, roughness, height = gen_harbor_stone(N, args.sources_dir)
        elif mat == 'snow_alpine':
            albedo, normal, ao, roughness, height = gen_snow_alpine(N, args.sources_dir)
        elif mat == 'volcano_basalt':
            albedo, normal, ao, roughness, height = gen_volcano_basalt(N, args.sources_dir)
        elif mat == 'wood_timber':
            albedo, normal, ao, roughness, height = gen_wood_timber(N, args.sources_dir)
        elif mat == 'sand_beach':
            albedo, normal, ao, roughness, height = gen_sand_beach(N)
        elif mat == 'dirt_path':
            albedo, normal, ao, roughness, height = gen_dirt_path(N, args.sources_dir)
        else:
            raise ValueError(f'Unknown material {mat}')

        # Save Albedo (2048x2048, target <= 1.6 MB)
        alb_path = os.path.join(args.output_dir, f'{mat}.jpg')
        size_alb, q_alb = save_jpeg_target_size(albedo, alb_path, start_quality=88, max_bytes=1.6 * 1024 * 1024)
        results.append((alb_path, size_alb, f'{N}x{N}', q_alb))

        # Save Normal (2048x2048, quality ~92)
        norm_path = os.path.join(args.output_dir, f'{mat}_normal.jpg')
        size_norm, q_norm = save_jpeg_target_size(normal, norm_path, start_quality=92, max_bytes=2.2 * 1024 * 1024)
        results.append((norm_path, size_norm, f'{N}x{N}', q_norm))

        # Save ORM (1024x1024 packed map: R=AO, G=Roughness, B=Height)
        orm = create_orm(ao, roughness, height, target_size=1024)
        orm_path = os.path.join(args.output_dir, f'{mat}_orm.jpg')
        size_orm, q_orm = save_jpeg_target_size(orm, orm_path, start_quality=88, max_bytes=1.2 * 1024 * 1024)
        results.append((orm_path, size_orm, '1024x1024', q_orm))

        # Seam verification
        c_r_alb, r_r_alb = seam_check(albedo)
        c_r_norm, r_r_norm = seam_check(normal)
        seam_results.append((f'{mat}.jpg', c_r_alb, r_r_alb, 'PASS' if c_r_alb <= 1.5 and r_r_alb <= 1.5 else 'FAIL'))
        seam_results.append((f'{mat}_normal.jpg', c_r_norm, r_r_norm, 'PASS' if c_r_norm <= 1.5 and r_r_norm <= 1.5 else 'FAIL'))

        # Save 2x2 previews
        prev_alb = make_2x2_tiled_preview(albedo, preview_size=1024)
        prev_alb_path = os.path.join(args.preview_dir, f'{mat}_preview.jpg')
        prev_alb.save(prev_alb_path, format='JPEG', quality=88)

        prev_norm = make_2x2_tiled_preview(normal, preview_size=1024)
        prev_norm_path = os.path.join(args.preview_dir, f'{mat}_normal_preview.jpg')
        prev_norm.save(prev_norm_path, format='JPEG', quality=88)

        # Store 512 crops for contact sheet
        albedo_512_crops[mat] = Image.fromarray(albedo[:512, :512])
        normal_512_crops[mat] = Image.fromarray(normal[:512, :512])

        t_elapsed = time.time() - t0
        print(f'  ✓ {mat}.jpg ({size_alb/1024/1024:.2f} MB, q={q_alb})')
        print(f'  ✓ {mat}_normal.jpg ({size_norm/1024/1024:.2f} MB, q={q_norm})')
        print(f'  ✓ {mat}_orm.jpg ({size_orm/1024:.1f} KB, q={q_orm})')
        print(f'  -> Finished in {t_elapsed:.2f}s')

    # Populate any missing materials from existing files for complete contact sheet
    for m in MATERIALS:
        if m not in albedo_512_crops or albedo_512_crops[m] is None:
            if m != 'water_normal':
                alb_f = os.path.join(args.output_dir, f'{m}.jpg')
                if os.path.exists(alb_f):
                    albedo_512_crops[m] = Image.open(alb_f).crop((0, 0, 512, 512))
            else:
                albedo_512_crops[m] = None
        if m not in normal_512_crops or normal_512_crops[m] is None:
            norm_f = os.path.join(args.output_dir, f'{m}_normal.jpg')
            if os.path.exists(norm_f):
                normal_512_crops[m] = Image.open(norm_f).crop((0, 0, 512, 512))

    # Generate Contact Sheet
    contact_sheet_path = os.path.join(args.preview_dir, 'native_crops_v2.jpg')
    generate_contact_sheet(albedo_512_crops, normal_512_crops, contact_sheet_path)

    total_time = time.time() - t_start
    print('\n========================================================================')
    print('                      SEAM VERIFICATION TABLE                          ')
    print('========================================================================')
    print(f'{"Texture File":<28} | {"Col Wrap/Int":<13} | {"Row Wrap/Int":<13} | {"Status":<6}')
    print('------------------------------------------------------------------------')
    all_passed = True
    for fname, c_r, r_r, status in seam_results:
        print(f'{fname:<28} | {c_r:<13.3f} | {r_r:<13.3f} | {status:<6}')
        if status != 'PASS':
            all_passed = False
    print('========================================================================')
    print(f'All seams passed (<= 1.5x): {all_passed}')
    print(f'Total runtime: {total_time:.2f}s')
    print('========================================================================\n')


if __name__ == '__main__':
    main()
