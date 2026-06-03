# INSPIRA Surat Generator — Node.js (23 Jenis Surat)

KOP INSPIRA sudah tertanam di dalam setiap file (base64).  
Tidak perlu file gambar eksternal.

## Setup (sekali saja)

```bash
npm install
```

## Cara Pakai

```bash
node 01_surat_keputusan.js
node 02_surat_edaran.js
node 03_surat_undangan_dinas.js
node 04_surat_kuasa.js
node 05_surat_keterangan.js
node 06_surat_pernyataan.js
node 07_sppd.js
node 08_surat_pengantar.js
node 09_memo.js
node 10_nota_dinas.js
node 11_surat_instruksi.js
node 12_surat_statuta.js
node 13_surat_resmi.js
node 14_surat_formal.js
node 15_surat_biasa.js
node 16_surat_konfidensial.js
node 17_surat_rahasia.js
node 18_mou.js
node 19_pks.js
node 20_kontrak.js
node 21_spk.js
node 22_surat_tugas_perorangan.js
node 23_surat_tugas_pendelegasian.js
```

Atau pakai npm scripts:
```bash
npm run 01   # SK
npm run 09   # Memo
npm run 18   # MOU
# dst...
```

## Alur

1. Jalankan file .js di terminal
2. Isi setiap pertanyaan, tekan Enter
3. Kosongkan untuk pakai nilai default (jika ada)
4. PDF otomatis dibuat

## Teknologi

- Node.js + Playwright (Chromium headless)
- HTML → PDF via Chromium
- KOP embedded base64 (tidak perlu file eksternal)
