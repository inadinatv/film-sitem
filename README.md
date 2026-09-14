# İnadına TV — Film Kuşağı

filmmodu.one kataloğunu otomatik olarak derleyen, Netflix tarzı arayüze sahip film sitesi.

## Nasıl çalışır?

| Dosya | Görev |
|---|---|
| `bot.php` | filmmodu.one kategori sayfalarını tarar, filmleri `movies.json` arşivine ekler |
| `movies.json` | Film arşivi (en yeni eklenen film her zaman en üstte) |
| `index.html` | Site arayüzü — kategoriler, arama, "YENİ" rozeti, detay penceresi |
| `api/info.js` | Seçilen filmin açıklamasını ve dil seçeneklerini (dublaj/altyazı) çeker |
| `api/play.js` | Film kaynağını çözer, altyazıları gömüp Plyr oynatıcıda sunar |
| `api/sub.js` | Altyazı dosyalarını SRT → VTT dönüşümüyle proxy'ler |
| `.github/workflows/bot.yml` | Botu her gece 03:00'te otomatik çalıştırır ve arşivi commit'ler |

## Bot kullanımı

```bash
php bot.php          # hızlı tarama: yeni filmler + eksik alan onarımı
php bot.php derin    # erken durdurma olmadan tüm arşivi baştan tarar
php bot.php tamir    # bozuk poster/başlık kayıtlarını detay sayfalarından onarır
```

Zamanlama: her gece 03:00'te **hızlı tarama**, her Pazar 04:00'te **derin tarama**
otomatik çalışır. `tamir` modu GitHub'da `Actions → Botu Calistir → Run workflow`
üzerinden elle tetiklenebilir.

Bot davranışı:

- Eski filmler **asla silinmez**; arşiv sadece büyür.
- Yeni bulunan filme `added` (eklenme tarihi) alanı eklenir.
- Başlık önceliği: **Türkçe ad → orijinal ad → slug'dan üretilen ad** (boş başlık kalmaz).
- Yeni eklenen filmler sitede filmmodu'daki gibi **en üstte** listelenir.
- Günlük çalıştırmada üst üste 3 sayfa boyunca yeni film görülmeyen kategori
  erken bitirilir; böylece tarama dakikalar içinde tamamlanır.
- GitHub Actions'ta `Actions → Botu Calistir → Run workflow` ile **tamir** modu
  elle tetiklenebilir.

## Yerel önizleme

```bash
python3 -m http.server 8080
# http://localhost:8080
```

> Not: `/api/*` uçları Vercel sunucusuz fonksiyonlarıdır; yerel önizlemede film
> detayları alınamazsa pencere otomatik olarak yedek oynatma butonlarına düşer.
