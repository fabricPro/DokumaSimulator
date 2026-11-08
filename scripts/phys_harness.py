"""reference/weave_phys.py'yi değiştirmeden çalıştırır ve metrikleri JSON'a yazar.

Kullanım:
  python -I scripts/phys_harness.py <çıktı klasörü> [flat]
    flat: rastgeleliği sabitler (uniform → aralık ortası, standard_normal → 0) — TS'in
          constantPhysicalRandom() ile piksel piksel karşılaştırma için. Etiket çizilmez.
"""
import importlib.util
import json
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('weave_phys', os.path.join(ROOT, 'reference', 'weave_phys.py'))
wp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wp)

out_dir = sys.argv[1] if len(sys.argv) > 1 else '.'
flat = len(sys.argv) > 2 and sys.argv[2] == 'flat'
os.makedirs(out_dir, exist_ok=True)


class FlatRng:
    def uniform(self, lo, hi, size):
        return np.full(size, (lo + hi) / 2.0)

    def standard_normal(self, shape):
        return np.zeros(shape)


if flat:
    wp.np.random.default_rng = lambda seed=None: FlatRng()

base = dict(
    weave=wp.dobby_fancy(),
    warp_slots=[dict(count=300, system='den', color='#e8e6e1'),
                dict(count=300, system='den', color='#3d434b')],
    warp_seq=[0, 1, 1, 0, 1, 1],
    weft_slots=[dict(count=600, system='den', color='#3d434b'),
                dict(count=150, system='den', color='#3fc0d2'),
                dict(count=8, system='Ne', color='#c9a24a', yarn_density=0.7),
                dict(count=300, system='den', color='#e8e6e1')],
    weft_seq=[0, 1, 0, 2, 0, 3],
    warp_density_loom=22, weft_density_loom=18,
    warp_shrink=0.0, weft_shrink=0.0, warp_crimp_share=0.4)
cases = [('tezgah', 0.00, 0.00), ('mamul_orta', 0.06, 0.10), ('mamul_yuksek', 0.12, 0.20)]
metrics = {}
for name, sc, sa in cases:
    sp = dict(base, warp_shrink=sc, weft_shrink=sa)
    _, m = wp.simulate(sp, out=os.path.join(out_dir, f'phys_{name}.png'), label=None)
    metrics[name] = {k: (bool(v) if isinstance(v, (bool, np.bool_)) else float(v)) for k, v in m.items()}
    print('ok', name)
with open(os.path.join(out_dir, 'phys_metrics.json'), 'w', encoding='utf-8') as f:
    json.dump(metrics, f, indent=2)
