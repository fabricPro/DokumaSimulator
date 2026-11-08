"""Fiziksel simülasyon: referans ve TS çıktılarını piksel + metrik olarak karşılaştırır.

Kullanım: python -I scripts/compare_phys.py <ref klasörü> <ts klasörü> [yan-yana klasörü] [--mask-label]
  Piksel farkında "1 mm" yazısı bölgesi (sol alt) her zaman maskelenir; --mask-label ile sol üst
  etiket kutusu da maskelenir (seed'li etiketli çıktılar için).
Metrikler: her biri için göreli fark %; ±%1 dışı olan 'FAIL' işaretlenir.
"""
import json
import os
import sys

import numpy as np
from PIL import Image

args = [a for a in sys.argv[1:] if not a.startswith('--')]
mask_label = '--mask-label' in sys.argv
ref_dir, ts_dir = args[0], args[1]
side_dir = args[2] if len(args) > 2 else None
if side_dir:
    os.makedirs(side_dir, exist_ok=True)

names = ['tezgah', 'mamul_orta', 'mamul_yuksek']
ok = True
print('--- piksel ---')
for name in names:
    a = np.asarray(Image.open(os.path.join(ref_dir, f'phys_{name}.png')).convert('RGB')).astype(np.int16)
    b = np.asarray(Image.open(os.path.join(ts_dir, f'phys_{name}.png')).convert('RGB')).astype(np.int16)
    if a.shape != b.shape:
        print(f'{name}: BOYUT FARKLI {a.shape} vs {b.shape}')
        ok = False
        continue
    h, w = a.shape[:2]
    m = np.ones((h, w), bool)
    m[h - 50:h - 31, 0:90] = False      # "1 mm" yazısı
    if mask_label:
        m[0:100, 0:475] = False          # etiket kutusu
    d = np.abs(a - b).max(axis=2)[m]
    print(f'{name:13s} ortalama={d.mean():.3f}  max={d.max():3d}  >2 seviye: %{(d > 2).mean() * 100:.3f}')
    if side_dir:
        canvas = Image.new('RGB', (w * 2 + 16, h), (255, 255, 255))
        canvas.paste(Image.fromarray(a.astype(np.uint8)), (0, 0))
        canvas.paste(Image.fromarray(b.astype(np.uint8)), (w + 16, 0))
        canvas.save(os.path.join(side_dir, f'phys_compare_{name}.png'))

ref_m_path = os.path.join(ref_dir, 'phys_metrics.json')
ts_m_path = os.path.join(ts_dir, 'phys_metrics.json')
if os.path.exists(ref_m_path) and os.path.exists(ts_m_path):
    rm = json.load(open(ref_m_path, encoding='utf-8'))
    tm = json.load(open(ts_m_path, encoding='utf-8'))
    print('--- metrikler (TS vs referans) ---')
    keys = ['Dw', 'Df', 'open_pct', 'cover', 'jam_w', 'jam_f', 'crimp_w', 'crimp_f', 'gsm']
    print(f"{'durum':13s} " + ' '.join(f'{k:>16s}' for k in keys) + '  jammed')
    for name in names:
        cells = []
        for k in keys:
            r, t = rm[name][k], tm[name][k]
            rel = abs(t - r) / abs(r) * 100 if r else abs(t - r)
            flag = '' if rel <= 1.0 else '!'
            if rel > 1.0:
                ok = False
            cells.append(f'{t:7.2f}/{r:7.2f}{flag:1s}')
        jam = 'ok' if rm[name]['jammed'] == tm[name]['jammed'] else 'FARK'
        if jam != 'ok':
            ok = False
        print(f'{name:13s} ' + ' '.join(f'{c:>16s}' for c in cells) + f'  {jam}')
print('SONUÇ:', 'EŞLEŞİYOR (metrikler ±%1 içinde)' if ok else 'FARK VAR')
