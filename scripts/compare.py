"""İki klasördeki out_*.png'leri karşılaştırır ve yan yana görsel üretir.

Kullanım: python -I scripts/compare.py <referans klasörü> <ts klasörü> [yan-yana çıktı klasörü]
Çıktı: görüntü başına ortalama / en büyük mutlak fark ve >2 seviye farklı piksel oranı.
"""
import os
import sys

import numpy as np
from PIL import Image

ref_dir, ts_dir = sys.argv[1], sys.argv[2]
side_dir = sys.argv[3] if len(sys.argv) > 3 else None
if side_dir:
    os.makedirs(side_dir, exist_ok=True)

worst = 0.0
for name in ['dobby', 'bezayagi', 'dimi31', 'saten5', 'panama']:
    a = np.asarray(Image.open(os.path.join(ref_dir, f'out_{name}.png')).convert('RGB')).astype(np.int16)
    b = np.asarray(Image.open(os.path.join(ts_dir, f'out_{name}.png')).convert('RGB')).astype(np.int16)
    if a.shape != b.shape:
        print(f'{name}: BOYUT FARKLI {a.shape} vs {b.shape}')
        worst = 1e9
        continue
    d = np.abs(a - b)
    frac = (d.max(axis=2) > 2).mean() * 100
    print(f'{name:9s} ortalama={d.mean():.3f}  max={d.max():3d}  >2 seviye: %{frac:.3f}')
    worst = max(worst, d.mean())
    if side_dir:
        h, w = a.shape[:2]
        canvas = Image.new('RGB', (w * 2 + 16, h), (255, 255, 255))
        canvas.paste(Image.fromarray(a.astype(np.uint8)), (0, 0))
        canvas.paste(Image.fromarray(b.astype(np.uint8)), (w + 16, 0))
        canvas.save(os.path.join(side_dir, f'compare_{name}.png'))
print('en kötü ortalama fark:', round(worst, 3))
