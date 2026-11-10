import sys
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import uniform_filter, gaussian_filter

f32 = np.float32
rng = np.random.default_rng(11)

def hx(h):
    h = h.lstrip('#'); return np.array([int(h[k:k+2], 16) for k in (0, 2, 4)], f32) / 255

def to_lin(c): return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(f32)
def to_srgb(c):
    c = np.clip(c, 0, 1); return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)

C = {'krem': '#E3DCC8', 'kahve': '#4E3A1E', 'hardal': '#CDAE66', 'bej': '#B9AD8C', 'taba': '#A99A78'}
bands = [(32,'krem',0),(2,'kahve',0),(22,'hardal',1),(2,'bej',0),(46,'hardal',1),(22,'krem',0),
         (10,'kahve',1),(14,'taba',1),(8,'kahve',1),(32,'krem',0),(2,'kahve',0),(22,'hardal',1),
         (3,'krem',0),(34,'hardal',1)]
wc, wt = [], []
for n, c, t in bands:
    wc += [hx(C[c])] * n; wt += [t] * n
wc = np.array(wc); wt = np.array(wt); NEND = len(wt)
weft_col = hx('#D8CFB6')

OFF = int(sys.argv[1]); NE = int(sys.argv[2]); PW = int(sys.argv[3]); HOUT = int(sys.argv[4]); OUT = sys.argv[5]
S = 2
pw = PW * S; ph = pw * 40 / 32
W = NE * pw; H = HOUT * S
y, x = np.mgrid[0:H, 0:W].astype(f32)

def M(i, j):
    i = np.mod(i, NEND); t = wt[i]
    return np.where(t == 1, np.mod(i - j, 4) < 3, (i + j) % 2 == 0)

fx = x / pw + OFF; fy = y / ph
i = np.floor(fx).astype(np.int32); u = (fx - i).astype(f32)
j = np.floor(fy).astype(np.int32); v = (fy - j).astype(f32)
sm = lambda s: ((1 - np.cos(np.pi * s)) / 2).astype(f32)

# hafif dalgalı iplik yolu (düzensizlik)
wob_w = rng.normal(0, 0.025, (NEND + 2, 8)).astype(f32)
wob_f = rng.normal(0, 0.03, (4000, 8)).astype(f32)
iu = np.mod(i, NEND)
u2 = u + wob_w[iu, 0] * np.sin(fy * 0.9 + wob_w[iu, 1] * 50) + wob_w[iu, 2] * np.sin(fy * 0.31 + 3)
v2 = v + wob_f[j % 4000, 0] * np.sin(fx * 0.7 + wob_f[j % 4000, 1] * 50)

t = fy - 0.5; j0 = np.floor(t).astype(np.int32); s = sm(t - j0)
a = 0.45
zw = np.where(M(i, j0), a, -a) * (1 - s) + np.where(M(i, j0 + 1), a, -a) * s
t = fx - 0.5; i0 = np.floor(t).astype(np.int32); s = sm(t - i0)
b = 0.40
zf = np.where(M(i0, j), -b, b) * (1 - s) + np.where(M(i0 + 1, j), -b, b) * s
del t, s, j0, i0

wwid = (0.87 + rng.normal(0, 0.03, NEND + 2)).astype(f32)
fwid = (0.76 + rng.normal(0, 0.035, 4000)).astype(f32)
# iplik boyunca kalınlık değişimi (düzgünsüzlük)
thick_w = 1 + 0.06 * np.sin(fy * 0.45 + iu * 1.7) * np.sin(fy * 0.13 + iu)
thick_f = 1 + 0.07 * np.sin(fx * 0.5 + j * 2.3) * np.sin(fx * 0.17 + j)
ww = wwid[iu] * thick_w; fw = fwid[j % 4000] * thick_f
cw = 1 - ((u2 - 0.5) / (ww / 2)) ** 2
cf = 1 - ((v2 - 0.5) / (fw / 2)) ** 2
hw = np.sqrt(np.clip(cw, 0, 1)); hf = np.sqrt(np.clip(cf, 0, 1))

# 2 katlı iplik: Z büküm katları (oluklar keskin), içinde S yönlü lifler
acw = (u2 - 0.5) * pw; acf = (v2 - 0.5) * ph
ply_w = np.abs(np.sin(np.pi * (y + 0.85 * acw) / (0.95 * pw))) ** 0.6
ply_f = np.abs(np.sin(np.pi * (x - 0.85 * acf) / (0.80 * pw))) ** 0.6
fibl_w = np.sin(2 * np.pi * (y - 0.6 * acw) / (0.09 * pw))
fibl_f = np.sin(2 * np.pi * (x + 0.6 * acf) / (0.09 * pw))
n = rng.normal(0, 1, (H, W)).astype(f32)
fib_w = gaussian_filter(n, sigma=(4 * S, 0.4 * S)); fib_w /= fib_w.std()
fib_f = gaussian_filter(n.T, sigma=(4 * S, 0.4 * S)).T; fib_f /= fib_f.std()
del n

rw, rf = 1.0, 0.80
Hw = np.where(cw > 0, zw + rw * hw * (0.82 + 0.18 * ply_w + 0.02 * fibl_w + 0.03 * fib_w), -9)
Hf = np.where(cf > 0, zf + rf * hf * (0.82 + 0.18 * ply_f + 0.02 * fibl_f + 0.03 * fib_f), -9)
is_w = Hw >= Hf
Hh = np.maximum(Hw, Hf).astype(f32)
gap = Hh < -5
Hh = np.where(gap, -2.2, Hh).astype(f32)
ply = np.where(is_w, ply_w, ply_f); fib = np.where(is_w, fib_w, fib_f); fibl = np.where(is_w, fibl_w, fibl_f)
del Hw, Hf, ply_w, ply_f, fibl_w, fibl_f, cw, cf, hw, hf, zw, zf

hs = pw * 0.33
Hp = gaussian_filter(Hh * hs, 0.6 * S)
gy, gx = np.gradient(Hp)
gx = np.clip(gx, -4, 4); gy = np.clip(gy, -4, 4)
nrm = np.sqrt(gx * gx + gy * gy + 1)
Nx, Ny, Nz = -gx / nrm, -gy / nrm, 1 / nrm

L = np.array([-0.50, -0.62, 0.60], f32); L /= np.linalg.norm(L)
Hv = L + np.array([0, 0, 1], f32); Hv /= np.linalg.norm(Hv)
ndl = Nx * L[0] + Ny * L[1] + Nz * L[2]
diff = np.clip(ndl * 0.75 + 0.25, 0, 1)

# Kajiya-Kay (iplik yönünde) — geniş + dar lob
Tx = np.where(is_w, 0, 1).astype(f32); Ty = np.where(is_w, 1, 0).astype(f32)
Tz = np.where(is_w, gy, gx); tn = np.sqrt(Tx ** 2 + Ty ** 2 + Tz ** 2)
TH = (Tx * Hv[0] + Ty * Hv[1] + Tz * Hv[2]) / tn
sinTH = np.sqrt(np.clip(1 - TH ** 2, 0, 1))
spec = 0.05 * sinTH ** 12 + 0.10 * sinTH ** 90

# yönlü gölge: heightfield üzerinde ışığa doğru ray-march
shadow = np.ones_like(Hp)
dirxy = -L[:2] / np.linalg.norm(L[:2]); slope = L[2] / np.linalg.norm(L[:2])
for k in range(1, int(1.2 * pw), max(1, S)):
    dx, dy = int(round(dirxy[0] * k)), int(round(dirxy[1] * k))
    sh = np.roll(np.roll(Hp, dy, 0), dx, 1)
    occ = np.clip((sh - (Hp + k * slope)) / (0.15 * pw), 0, 1)
    shadow = np.minimum(shadow, 1 - 0.75 * occ)
shadow = gaussian_filter(shadow, 1.2 * S)

ao = np.zeros_like(Hh)
for r, k in ((pw * 0.35, 1.0), (pw * 0.9, 0.9), (pw * 2.0, 0.5)):
    ao += k * np.clip(uniform_filter(Hh, size=int(r)) - Hh, 0, None)
ao = np.clip(1 - 0.6 * ao, 0.05, 1)
cav = np.clip(0.55 + 0.45 * ply, 0, 1)   # kat oluklarında kararma

jit_w = (1 + rng.normal(0, 0.03, (NEND + 2, 3))).astype(f32)
jit_f = (1 + rng.normal(0, 0.025, (4000, 1))).astype(f32)
alb = np.where(is_w[..., None], to_lin(wc[iu]) * jit_w[iu], to_lin(weft_col)[None, None] * jit_f[j % 4000])
heather = 1 + 0.10 * fib + 0.05 * fibl
alb = alb * heather[..., None]

lightv = (0.22 * ao + 0.95 * diff * shadow * ao) * cav
col = alb * lightv[..., None] + (spec * shadow * ao * cav)[..., None]
col = np.where(gap[..., None], np.array([0.006, 0.005, 0.004], f32), col)
img = to_srgb(col * 1.25)
im = Image.fromarray((img * 255).astype(np.uint8))

# tüylülük: iplik yüzeyinden çıkan ince lifler
ov = Image.new('RGBA', im.size, (0, 0, 0, 0)); d = ImageDraw.Draw(ov)
arr = np.asarray(im)
nf = int(W * H / (pw * pw) * 5)
for _ in range(nf):
    px, py = rng.integers(0, W), rng.integers(0, H)
    if gap[py, px]: continue
    vert = is_w[py, px]
    ang = (np.pi / 2 if vert else 0) + rng.normal(0, 0.5)
    ln = rng.uniform(0.25, 0.9) * pw
    cx, cy = px, py; pts = [(cx, cy)]
    for _s in range(4):
        ang += rng.normal(0, 0.25)
        cx += np.cos(ang) * ln / 4; cy += np.sin(ang) * ln / 4; pts.append((cx, cy))
    c = arr[py, px].astype(int)
    c = tuple(int(min(255, cc * 1.15 + 12)) for cc in c)
    d.line(pts, fill=c + (int(rng.uniform(60, 140)),), width=max(1, S // 2))
im = Image.alpha_composite(im.convert('RGBA'), ov).convert('RGB')
im = im.resize((W // S, H // S), Image.LANCZOS)
im.save(OUT)
print(im.size)
