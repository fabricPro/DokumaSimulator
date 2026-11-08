"""Heightfield tabanlı dokuma render motoru (referans implementasyon).

Her piksel için çözgü ve atkı ipliğinin yüksekliği hesaplanır, en yüksek olan
görünür. Yükseklik = iplik kesit profili + örgüye göre aşağı/yukarı dalga +
büküm (ply) kabartması. Sonra yükseklik haritasından normal, ışık, gölge ve
ortam kapatması (AO) üretilir.
"""
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter
import sys


def smoothstep(t):
    return t * t * (3 - 2 * t)


def along_height(pos_cells, states):
    """İplik boyunca yükseklik: hücre merkezlerinde +1/-1, arası yumuşak geçiş."""
    t = pos_cells - 0.5
    k0 = np.floor(t).astype(int)
    f = smoothstep(t - k0)
    n = states.shape[-1]
    return k0, f, n


def render(M, warp_colors, weft_colors, cell=36, n_warp=28, n_weft=28,
           yarn_ratio=0.74, ply_pitch=0.55, twist_angle=0.65, seed=3,
           wobble=1.6, out=None):
    rng = np.random.default_rng(seed)
    M = np.asarray(M, dtype=bool)          # M[row, col], True = çözgü üstte, row 0 = en alt atkı
    R_r, R_c = M.shape
    W, H = n_warp * cell, n_weft * cell
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    yb = (H - 1) - yy                      # alttan yukarı koordinat

    r = yarn_ratio * cell / 2.0            # iplik yarıçapı (px)
    amp = r * 0.85                         # bağlantı dalga genliği

    # --- çözgü (dikey iplikler) ---
    i = np.clip((xx // cell).astype(int), 0, n_warp - 1)
    ph_w = rng.uniform(0, 2 * np.pi, n_warp)
    cx = (i + 0.5) * cell + wobble * np.sin(yb / (cell * 3.1) + ph_w[i])
    dx = xx - cx
    # örgü boyunca yükseklik
    t = yb / cell - 0.5
    k0 = np.floor(t).astype(int)
    f = smoothstep(t - k0)
    s0 = np.where(M[k0 % R_r, i % R_c], 1.0, -1.0)
    s1 = np.where(M[(k0 + 1) % R_r, i % R_c], 1.0, -1.0)
    hw_wave = (s0 * (1 - f) + s1 * f) * amp
    dw = np.clip(np.abs(dx) / r, 0, 1)
    prof_w = r * 0.6 * np.sqrt(np.clip(1 - dw ** 2, 0, 1))
    cov_w = np.abs(dx) < r

    # --- atkı (yatay iplikler) ---
    j = np.clip((yb // cell).astype(int), 0, n_weft - 1)
    ph_f = rng.uniform(0, 2 * np.pi, n_weft)
    cy = (j + 0.5) * cell + wobble * np.sin(xx / (cell * 2.7) + ph_f[j])
    dy = yb - cy
    t2 = xx / cell - 0.5
    k2 = np.floor(t2).astype(int)
    f2 = smoothstep(t2 - k2)
    q0 = np.where(M[j % R_r, k2 % R_c], -1.0, 1.0)
    q1 = np.where(M[j % R_r, (k2 + 1) % R_c], -1.0, 1.0)
    hf_wave = (q0 * (1 - f2) + q1 * f2) * amp
    df = np.clip(np.abs(dy) / r, 0, 1)
    prof_f = r * 0.6 * np.sqrt(np.clip(1 - df ** 2, 0, 1))
    cov_f = np.abs(dy) < r

    # --- büküm (2 katlı iplik) kabartması ---
    pitch = ply_pitch * cell
    def ply(u, v):
        # v: kesit içinde -1..1, u: iplik boyunca px
        phase = (u + v * r * twist_angle * 2.0) / pitch
        s = np.abs(np.sin(np.pi * phase))
        return np.sqrt(s)                  # 0 = katlar arası oluk, 1 = kat sırtı
    ply_w = ply(yb, dx / r)
    ply_f = ply(xx, -dy / r)

    # lif gürültüsü: iplik yönünde uzatılmış
    def fiber_noise(shape, along_axis):
        n = rng.standard_normal(shape).astype(np.float32)
        sig = (5, 1.3) if along_axis == 0 else (1.3, 5)
        n = gaussian_filter(n, sig)
        return n / (n.std() + 1e-6)
    fn_w = fiber_noise((H, W), 0)
    fn_f = fiber_noise((H, W), 1)

    bump = r * 0.42
    Hw = np.where(cov_w, hw_wave + prof_w + bump * ply_w + 0.25 * fn_w, -1e3)
    Hf = np.where(cov_f, hf_wave + prof_f + bump * ply_f + 0.25 * fn_f, -1e3)
    bg = -amp - r * 1.2
    top_w = Hw >= Hf
    Hmap = np.maximum(np.maximum(Hw, Hf), bg)
    is_bg = Hmap <= bg + 1e-3

    # --- renkler ---
    def hex2rgb(h):
        h = h.lstrip('#')
        return np.array([int(h[k:k + 2], 16) for k in (0, 2, 4)], dtype=np.float32) / 255
    wc = np.stack([hex2rgb(c) for c in warp_colors])
    fc = np.stack([hex2rgb(c) for c in weft_colors])
    var_w = 1 + rng.uniform(-0.06, 0.06, n_warp)
    var_f = 1 + rng.uniform(-0.06, 0.06, n_weft)
    col_w = wc[i % len(wc)] * var_w[i][..., None]
    col_f = fc[j % len(fc)] * var_f[j][..., None]
    base = np.where(top_w[..., None], col_w, col_f)
    plyv = np.where(top_w, ply_w, ply_f)
    fnv = np.where(top_w, fn_w, fn_f)
    base = base * (0.80 + 0.20 * plyv[..., None]) * (1 + 0.09 * fnv[..., None])

    # --- normal + ışık ---
    Hs = gaussian_filter(Hmap, 0.7)
    gy, gx = np.gradient(Hs)
    gy = -gy                                # görüntü y'si aşağı
    nx, ny, nz = -gx, -gy, np.ones_like(gx)
    nl = np.sqrt(nx ** 2 + ny ** 2 + nz ** 2)
    nx, ny, nz = nx / nl, ny / nl, nz / nl
    L = np.array([-0.20, 0.62, 0.70]); L /= np.linalg.norm(L)
    diff = np.clip(nx * L[0] + ny * L[1] + nz * L[2], 0, 1)
    Hv = np.array([L[0], L[1], L[2] + 1]); Hv /= np.linalg.norm(Hv)
    spec = np.clip(nx * Hv[0] + ny * Hv[1] + nz * Hv[2], 0, 1) ** 18

    # --- ekran uzayı gölge (ışık yönünde ilerle) ---
    shadow = np.ones_like(Hmap)
    step_x, step_y = 1, 1                  # ışık sol-üstten → sol-üste bak
    for k in range(1, 14):
        sh = np.roll(np.roll(Hmap, k * step_y, axis=0), k * step_x, axis=1)
        blocked = sh > Hmap + k * 1.1
        shadow = np.where(blocked, np.minimum(shadow, 0.35 + 0.04 * k), shadow)
    shadow = gaussian_filter(shadow, 1.2)

    # --- ortam kapatması: alçak yerler koyu ---
    hn = (Hmap - bg) / (amp + r * 0.6 + bump - bg)
    ao = np.clip(0.30 + 0.85 * hn, 0.18, 1.0)
    blurred = gaussian_filter(Hmap, 4)
    cavity = np.clip(1 - np.clip(blurred - Hmap, 0, None) / (r * 0.9), 0.35, 1)

    light = (0.22 + 0.95 * diff) * shadow * ao * cavity
    rgb = base * light[..., None] + 0.12 * spec[..., None] * shadow[..., None]
    rgb = np.where(is_bg[..., None], np.array([0.035, 0.04, 0.05]), rgb)
    rgb = np.clip(rgb, 0, 1) ** (1 / 1.1)
    img = Image.fromarray((rgb * 255).astype(np.uint8))
    if out:
        img.save(out)
    return img


# ---------------- örgüler ----------------
def plain(): return [[(x + y) % 2 == 0 for x in range(2)] for y in range(2)]
def twill31(): return [[(x - y) % 4 != 3 for x in range(4)] for y in range(4)]
def twill22(): return [[(x - y) % 4 < 2 for x in range(4)] for y in range(4)]
def satin5(): return [[(x * 1 + y * 2) % 5 != 0 for x in range(5)] for y in range(5)]
def hopsack(): return [[((x // 2) + (y // 2)) % 2 == 0 for x in range(4)] for y in range(4)]
def dobby_fancy():
    # referans görsele benzer: dimi/basket karışımı armür motifi (12x12)
    s = """
    101100101101
    010011010010
    101101100101
    110010011010
    001101101101
    110100110010
    101011001101
    010110110010
    101001011011
    011110100100
    100101011011
    011010100100
    """
    rows = [r.strip() for r in s.strip().splitlines()]
    return [[c == '1' for c in r] for r in rows[::-1]]


if __name__ == '__main__':
    T, G = '#3fc0d2', '#4a5058'
    warp = [T, G, T, G, G, T, G, T]
    weft = [G, T, G, G, T, G, T, T, G]
    which = sys.argv[1] if len(sys.argv) > 1 else 'all'
    jobs = {
        'dobby': (dobby_fancy(), warp, weft),
        'bezayagi': (plain(), [T, G], [G, T]),
        'dimi31': (twill31(), [T], [G]),
        'saten5': (satin5(), ['#8e2b3a'], ['#d9cdb4']),
        'panama': (hopsack(), ['#1f3a6b', '#1f3a6b', '#c9a24a', '#c9a24a'], ['#c9a24a', '#c9a24a', '#1f3a6b', '#1f3a6b']),
    }
    for name, (m, wc, fc) in jobs.items():
        if which != 'all' and which != name:
            continue
        render(m, wc, fc, out=f'out_{name}.png')
        print('ok', name)
