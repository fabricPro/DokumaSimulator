# Kalibrasyon fotoğrafları

Bu klasöre gerçek kumaşın makro fotoğraflarını (`.jpg`, `.png` veya `.webp`) koyun. Kalibrasyon ekranındaki
"calibration/photos/" listesinde görünürler. Dosya eklendikten sonra sayfayı yenilemek gerekebilir.

Fotoğraf, simülasyonla aynı mm ölçeğinde yan yana ya da perde modunda gösterilir. Ölçeği iki yoldan biriyle verin:

- **Yan dosya:** fotoğrafla aynı adlı bir `.json` dosyası. Örneğin `bendix-v3.jpg` için `bendix-v3.json`:

  ```json
  { "pxPerCm": 1180 }
  ```

- **Ekrandan:** kalibrasyon ekranında px/cm değerini elle girin ya da "İki nokta ile ölç" ile fotoğraftaki cetvelden
  ölçün.

Fotoğraflar yalnız bu tarayıcıda açılır, hiçbir yere gönderilmez. Paketleme kaydırıcılarıyla (tip başına en/boy,
doldurma oranı, sıkışma) simülasyonu fotoğrafa yaklaştırın, sonra ayarları preset olarak indirin.
