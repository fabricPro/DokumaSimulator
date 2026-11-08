"""Fiziksel ölçekli dokuma simülasyonu (referans implementasyon v2).

Katmanlar:
  1. iplik_fizigi   : numara -> tex -> çap (mm)
  2. konum_uretici  : tezgah sıklığı + çekme -> iplik merkez konumları (mm)
                      (ileride tarak raporu buraya ikinci bir üretici olarak takılır)
  3. sikisma        : komşu iplikler çakışırsa genişlik daralır, yükseklik artar; Ashenhurst sınırı
  4. render         : heightfield (v1 ile aynı mantık, ama her iplik kendi çapında ve konumunda)
  5. metrikler      : mamul sıklık, açıklık %, örtme faktörü, kıvrım, gramaj
"""
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter

# ---------------------------------------------------------------- 1. iplik fiziği
def to_tex(count, system):
    s = system.lower()
    if s == 'ne': return 590.5 / count
    if s == 'nm': return 1000.0 / count
    if s == 'dtex': return count / 10.0
    if s in ('den', 'denier', 'denye'): return count / 9.0
    if s == 'tex': return float(count)
    raise ValueError(system)

def diameter_mm(tex, yarn_density=0.85):
    """d = 0.0357 * sqrt(tex / rho_iplik). rho_iplik: iplik hacim yoğunluğu (g/cm3),
    lif yoğunluğu x paketleme. Filament PES ~1.0, spun ~0.8."""
    return 0.0357 * np.sqrt(tex / yarn_density)

# ---------------------------------------------------------------- 2. konum üretici
def uniform_positions(n, density_per_cm):
    p = 10.0 / density_per_cm
    return (np.arange(n) + 0.5) * p

# ---------------------------------------------------------------- 3. sıkışma
def squeeze(centers, radii, min_scale=0.55):
    """Komşu merkez mesafesi < r_k + r_k+1 ise iki ipliği orantılı daralt.
    Genişlik ölçeği s (<=1), yükseklik ölçeği s^-0.5 (yanal sıkışan iplik yükselir)."""
    n = len(centers)
    s = np.ones(n)
    for k in range(n - 1):
        gap = centers[k + 1] - centers[k]
        need = radii[k] + radii[k + 1]
        if need > gap:
            f = gap / need
            s[k] = min(s[k], f); s[k + 1] = min(s[k + 1], f)
    jammed = s < min_scale
    s = np.maximum(s, min_scale)
    return s, s ** -0.5, jammed

def ashenhurst_max(M, axis, d_mm):
    """Teorik maksimum sıklık (tel/cm). axis=0 -> çözgü (sütunlar), 1 -> atkı (satırlar).
    E = rapordaki iplik, I = rapor boyunca bağlantı değişimi sayısı (ortalama)."""
    M = np.asarray(M, bool)
    lines = M.T if axis == 0 else M         # her satır = bir iplik boyunca durumlar
    E = lines.shape[1]
    I = np.mean([np.sum(l != np.roll(l, 1)) for l in lines])
    return 10.0 / d_mm * E / (E + I), E, I

# ---------------------------------------------------------------- yardımcılar
def hex2rgb(h):
    h = h.lstrip('#')
    return np.array([int(h[k:k + 2], 16) for k in (0, 2, 4)], np.float32) / 255

def smoothstep(t):
    t = np.clip(t, 0, 1); return t * t * (3 - 2 * t)

def nearest_index(c, x):
    k = np.clip(np.searchsorted(c, x), 1, len(c) - 1)
    left = (x - c[k - 1]) < (c[k] - x)
    return np.where(left, k - 1, k)

def interval(c, x):
    k0 = np.clip(np.searchsorted(c, x) - 1, 0, len(c) - 2)
    f = (x - c[k0]) / (c[k0 + 1] - c[k0])
    return k0, smoothstep(f)

# ---------------------------------------------------------------- ana simülasyon
def simulate(spec, view_mm=8.0, px_per_mm=110, seed=3, out=None, label=None):
    rng = np.random.default_rng(seed)
    M = np.asarray(spec['weave'], bool)       # M[satır=atkı, sütun=çözgü], satır 0 en alt
    Rr, Rc = M.shape

    # mamul sıklıklar: çözgü çekmesi boyu kısaltır -> atkı sıklığı artar; atkı çekmesi eni daraltır -> çözgü sıklığı artar
    Dw = spec['warp_density_loom'] / (1 - spec['weft_shrink'])
    Df = spec['weft_density_loom'] / (1 - spec['warp_shrink'])

    # iplikler
    def yarn_table(slots, seq, n):
        tex = np.array([to_tex(s['count'], s['system']) for s in slots])
        d = np.array([diameter_mm(t, s.get('yarn_density', 0.85)) for t, s in zip(tex, slots)])
        col = np.stack([hex2rgb(s['color']) for s in slots])
        idx = np.array([seq[k % len(seq)] for k in range(n)])
        return idx, tex, d, col
    nW = int(np.ceil(view_mm * Dw / 10)) + 3
    nF = int(np.ceil(view_mm * Df / 10)) + 3
    wi, wtex, wd, wcol = yarn_table(spec['warp_slots'], spec['warp_seq'], nW)
    fi, ftex, fd, fcol = yarn_table(spec['weft_slots'], spec['weft_seq'], nF)

    xc = uniform_positions(nW, Dw) - 10 / Dw          # mm, bir iplik pencere dışından başlasın
    yc = uniform_positions(nF, Df) - 10 / Df
    rw = wd[wi] / 2; rf = fd[fi] / 2
    sw, hw_s, jw = squeeze(xc, rw)
    sf, hf_s, jf = squeeze(yc, rf)

    # piksel ızgarası (mm)
    Npx = int(view_mm * px_per_mm)
    yy, xx = np.mgrid[0:Npx, 0:Npx].astype(np.float32)
    X = xx / px_per_mm
    Y = ((Npx - 1) - yy) / px_per_mm                  # alttan yukarı

    wob = 0.012
    phw = rng.uniform(0, 6.28, nW); phf = rng.uniform(0, 6.28, nF)
    i = nearest_index(xc, X)
    dx = X - (xc[i] + wob * np.sin(Y * 2.1 + phw[i]))
    j = nearest_index(yc, Y)
    dy = Y - (yc[j] + wob * np.sin(X * 2.3 + phf[j]))

    a_w = rw[i] * sw[i]; b_w = rw[i] * hw_s[i]
    a_f = rf[j] * sf[j]; b_f = rf[j] * hf_s[j]

    # kıvrım genliği (Peirce: h1 + h2 = (d1 + d2)/2), çözgü daha az kıvrılır
    beta = spec.get('warp_crimp_share', 0.4)
    D = (rw[i] + rf[j])
    k0, f = interval(yc, Y)
    s0 = np.where(M[k0 % Rr, i % Rc], 1., -1.); s1 = np.where(M[(k0 + 1) % Rr, i % Rc], 1., -1.)
    wave_w = (s0 * (1 - f) + s1 * f) * D * beta
    k2, f2 = interval(xc, X)
    q0 = np.where(M[j % Rr, k2 % Rc], -1., 1.); q1 = np.where(M[j % Rr, (k2 + 1) % Rc], -1., 1.)
    wave_f = (q0 * (1 - f2) + q1 * f2) * D * (1 - beta)

    def prof(d, a, b):
        u = np.clip(np.abs(d) / a, 0, 1)
        return 0.6 * b * np.sqrt(1 - u * u)

    def ply(u, v, r):
        pitch = 1.5 * r
        ph = (u + v * r * 1.3) / pitch
        return np.sqrt(np.abs(np.sin(np.pi * ph)))
    ply_w = ply(Y, dx / a_w, rw[i]); ply_f = ply(X, -dy / a_f, rf[j])

    def fiber_noise(axis):
        n = rng.standard_normal((Npx, Npx)).astype(np.float32)
        r_px = np.median(rw) * px_per_mm
        sig = (0.38 * r_px, 0.1 * r_px) if axis == 0 else (0.1 * r_px, 0.38 * r_px)
        n = gaussian_filter(n, sig); return n / (n.std() + 1e-6)
    fn_w = fiber_noise(0); fn_f = fiber_noise(1)

    cov_w = np.abs(dx) < a_w; cov_f = np.abs(dy) < a_f
    Hw = np.where(cov_w, wave_w + prof(dx, a_w, b_w) + 0.42 * rw[i] * ply_w + 0.02 * rw[i] * fn_w, -1e3)
    Hf = np.where(cov_f, wave_f + prof(dy, a_f, b_f) + 0.42 * rf[j] * ply_f + 0.02 * rf[j] * fn_f, -1e3)
    bg = -(rw.max() + rf.max()) * 1.4
    top_w = Hw >= Hf
    Hm = np.maximum(np.maximum(Hw, Hf), bg)
    is_bg = Hm <= bg + 1e-6
    Hpx = Hm * px_per_mm                                 # yüksekliği piksel cinsine çevir (normal için)

    var_w = 1 + rng.uniform(-.05, .05, nW); var_f = 1 + rng.uniform(-.05, .05, nF)
    base = np.where(top_w[..., None], wcol[wi][i] * var_w[i][..., None], fcol[fi][j] * var_f[j][..., None])
    plyv = np.where(top_w, ply_w, ply_f); fnv = np.where(top_w, fn_w, fn_f)
    base = base * (0.80 + 0.20 * plyv[..., None]) * (1 + 0.08 * fnv[..., None])

    r_px = float(np.median(np.concatenate([rw, rf])) * px_per_mm)
    Hs = gaussian_filter(Hpx, 0.05 * r_px)
    gy, gx = np.gradient(Hs); gy = -gy
    nx, ny, nz = -gx, -gy, np.ones_like(gx)
    nl = np.sqrt(nx * nx + ny * ny + nz * nz); nx /= nl; ny /= nl; nz /= nl
    L = np.array([-0.20, 0.62, 0.70]); L /= np.linalg.norm(L)
    diff = np.clip(nx * L[0] + ny * L[1] + nz * L[2], 0, 1)
    Hv = L + np.array([0, 0, 1]); Hv /= np.linalg.norm(Hv)
    spec_ = np.clip(nx * Hv[0] + ny * Hv[1] + nz * Hv[2], 0, 1) ** 18

    shadow = np.ones_like(Hpx)
    steps = max(6, int(r_px))
    for k in range(1, steps):
        sh = np.roll(np.roll(Hpx, k, 0), k, 1)
        shadow = np.where(sh > Hpx + k * 1.1, np.minimum(shadow, 0.35 + 0.6 * k / steps), shadow)
    shadow = gaussian_filter(shadow, 0.09 * r_px)
    hn = (Hm - bg) / (Hm.max() - bg + 1e-9)
    ao = np.clip(0.30 + 0.85 * hn, 0.18, 1)
    blur = gaussian_filter(Hpx, 0.3 * r_px)
    cav = np.clip(1 - np.clip(blur - Hpx, 0, None) / (0.9 * r_px), 0.35, 1)

    light = (0.18 + 0.80 * diff) * shadow * ao * cav
    lum = base.mean(-1, keepdims=True)
    rgb = base * light[..., None] + 0.10 * (1 - 0.6 * lum) * spec_[..., None] * shadow[..., None]
    rgb = rgb / (1 + 0.35 * rgb) * 1.35                  # yumuşak tavan: beyaz patlamasın
    rgb = np.where(is_bg[..., None], np.array([0.035, 0.04, 0.05]), rgb)
    img = Image.fromarray((np.clip(rgb, 0, 1) ** (1 / 1.1) * 255).astype(np.uint8))

    # -------------------------------------------- metrikler
    dw_avg = np.mean(wd[wi]); df_avg = np.mean(fd[fi])
    cw = min(1, Dw / 10 * dw_avg); cf = min(1, Df / 10 * df_avg)
    maxW, E_w, I_w = ashenhurst_max(M, 0, dw_avg)
    maxF, E_f, I_f = ashenhurst_max(M, 1, df_avg)
    hcr_w = (dw_avg + df_avg) / 2 * beta; hcr_f = (dw_avg + df_avg) / 2 * (1 - beta)
    crimp_w = 8 / 3 * (hcr_w / (10 / Df)) ** 2 * (I_w / E_w)
    crimp_f = 8 / 3 * (hcr_f / (10 / Dw)) ** 2 * (I_f / E_f)
    gsm = Dw * 100 * np.mean(wtex[wi]) / 1000 * (1 + crimp_w) + Df * 100 * np.mean(ftex[fi]) / 1000 * (1 + crimp_f)
    m = dict(Dw=Dw, Df=Df, open_pct=100 * is_bg.mean(), cover=100 * (1 - (1 - cw) * (1 - cf)),
             jam_w=100 * Dw / maxW, jam_f=100 * Df / maxF, crimp_w=100 * crimp_w, crimp_f=100 * crimp_f,
             gsm=gsm, jammed=bool(jw.any() or jf.any()))

    # ölçek çubuğu + etiket
    dr = ImageDraw.Draw(img)
    from PIL import ImageFont
    try: font = ImageFont.truetype('DejaVuSans.ttf', 15)
    except OSError: font = ImageFont.load_default()
    bar = int(px_per_mm)
    dr.rectangle([12, Npx - 30, 12 + bar, Npx - 24], fill=(240, 240, 240))
    dr.text((12, Npx - 48), '1 mm', fill=(240, 240, 240), font=font)
    if label:
        txt = (f"{label}\nçözgü {Dw:.1f} tel/cm  atkı {Df:.1f} atkı/cm\n"
               f"açıklık %{m['open_pct']:.1f}  örtme %{m['cover']:.0f}  ~{gsm:.0f} g/m²\n"
               f"sıkışma: çözgü %{m['jam_w']:.0f}  atkı %{m['jam_f']:.0f}")
        dr.rectangle([8, 8, 470, 98], fill=(0, 0, 0))
        dr.multiline_text((14, 12), txt, fill=(235, 235, 235), spacing=4, font=font)
    if out: img.save(out)
    return img, m


# ---------------------------------------------------------------- örnek
def dobby_fancy():
    s = """101100101101
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
011010100100"""
    return [[c == '1' for c in r] for r in s.splitlines()[::-1]]

if __name__ == '__main__':
    base = dict(
        weave=dobby_fancy(),
        warp_slots=[dict(count=300, system='den', color='#e8e6e1'),
                    dict(count=300, system='den', color='#3d434b')],
        warp_seq=[0, 1, 1, 0, 1, 1],
        weft_slots=[dict(count=600, system='den', color='#3d434b'),          # A kalın gri
                    dict(count=150, system='den', color='#3fc0d2'),          # B ince turkuaz
                    dict(count=8, system='Ne', color='#c9a24a', yarn_density=0.7),  # C şönil benzeri kalın
                    dict(count=300, system='den', color='#e8e6e1')],         # D beyaz
        weft_seq=[0, 1, 0, 2, 0, 3],
        warp_density_loom=22, weft_density_loom=18,
        warp_shrink=0.0, weft_shrink=0.0, warp_crimp_share=0.4)
    cases = [('tezgah', 0.00, 0.00), ('mamul_orta', 0.06, 0.10), ('mamul_yuksek', 0.12, 0.20)]
    for name, sc, sa in cases:
        sp = dict(base, warp_shrink=sc, weft_shrink=sa)
        _, m = simulate(sp, out=f'phys_{name}.png',
                        label=f"{name}  çözgü çekmesi %{sc*100:.0f}  atkı çekmesi %{sa*100:.0f}")
        print(name, {k: (round(v, 1) if isinstance(v, float) else v) for k, v in m.items()})
