"""Referans render'ı gürültüsüz (deterministik) modda çalıştırır.

reference/weave_render.py'ye dokunmadan np.random.default_rng'yi sabit değer döndüren
bir sahte üreticiyle değiştirir: uniform → aralığın ortası, standard_normal → 0.
TS motoru `constantRandomSource()` ile aynı değerleri kullanır; böylece iki çıktı piksel
piksel karşılaştırılabilir.

Kullanım: python -I scripts/reference_harness.py <çıktı klasörü>
"""
import importlib.util
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('weave_render', os.path.join(ROOT, 'reference', 'weave_render.py'))
wr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wr)


class FlatRng:
    def uniform(self, lo, hi, size):
        return np.full(size, (lo + hi) / 2.0)

    def standard_normal(self, shape):
        return np.zeros(shape)


wr.np.random.default_rng = lambda seed=None: FlatRng()

out_dir = sys.argv[1] if len(sys.argv) > 1 else 'flat'
os.makedirs(out_dir, exist_ok=True)
T, G = '#3fc0d2', '#4a5058'
jobs = {
    'dobby': (wr.dobby_fancy(), [T, G, T, G, G, T, G, T], [G, T, G, G, T, G, T, T, G]),
    'bezayagi': (wr.plain(), [T, G], [G, T]),
    'dimi31': (wr.twill31(), [T], [G]),
    'saten5': (wr.satin5(), ['#8e2b3a'], ['#d9cdb4']),
    'panama': (wr.hopsack(), ['#1f3a6b', '#1f3a6b', '#c9a24a', '#c9a24a'],
               ['#c9a24a', '#c9a24a', '#1f3a6b', '#1f3a6b']),
}
for name, (m, wc, fc) in jobs.items():
    wr.render(m, wc, fc, out=os.path.join(out_dir, f'out_{name}.png'))
    print('ok', name)
