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
- Dil kategorilerindeki tekil/çoğul URL değişiklikleri için otomatik alternatif yol
  denenir; kaynak site yolu değişse bile yeni filmler çekilmeye devam eder.
- Ana ekran ilk açılışta Türkçe dublajı öne alır; aynı sekmede sabit liste yerine
  ziyaret bazlı seed ile farklı film kartları gösterir. `playable: false` kayıtlar
  bot tarafından elendiğinde sitede listelenmez.
- Oynatıcı, kaynak sitenin tek ve çift tırnaklı ve farklı video kaynağı JSON
  biçimlerini destekler; geçerli kaynak yoksa kullanıcıya net hata verir.
- GitHub Actions'ta `Actions → Botu Calistir → Run workflow` ile **tamir** modu
  elle tetiklenebilir. Tamir her çalışmada arşivin ilk 500 kaydını oynatıcı/kaynak
  kontrolünden geçirir; kaldırılan kayıtları siler ve kalanları `playable` alanıyla işaretler.

## Yerel önizleme

```bash
python3 -m http.server 8080
# http://localhost:8080
```

> Not: `/api/*` uçları Vercel sunucusuz fonksiyonlarıdır; yerel önizlemede film
> detayları alınamazsa pencere otomatik olarak yedek oynatma butonlarına düşer.

## GitHub Pages yayını

`main` dalına yapılan her push sonrasında `.github/workflows/pages.yml` workflow'u
siteyi otomatik olarak GitHub Pages'e dağıtır. GitHub deposunda bir kez
`Settings → Pages → Source: GitHub Actions` seçilmelidir.

GitHub Pages statik hosting olduğu için `api/info.js`, `api/play.js` ve `api/sub.js`
çalışmaz. Katalog, arama, kategoriler ve film kartları çalışır; detay penceresinde
API erişilemezse kullanıcı kaynak film sayfasına yönlendirilir. Tam oynatıcı ve
altyazı desteği için bu API uçlarının Vercel veya başka bir sunucusuz platformda
çalışıyor olması gerekir.

## Cloudflare Worker player API

Vercel beklenmeden player backend'i `worker/` klasöründeki Cloudflare Worker'a
taşınabilir. Worker şu uçları sağlar:

- `/api/info?id=...` — film açıklaması ve dil seçenekleri
- `/api/play?id=...&lang=tr|en` — Plyr/HLS oynatıcı sayfası
- `/api/sub?url=...` — altyazı proxy'si

Kurulum için Cloudflare hesabında bir API token oluşturup şu komutları çalıştır:

```bash
cd worker
npm install
npx wrangler login
npx wrangler deploy
```

Deploy sonunda verilen `workers.dev` adresini kökteki `api-config.js` dosyasına yaz:

```js
window.FILM_API_BASE = 'https://inadina-tv-player-api.<hesap>.workers.dev';
```

Alternatif olarak GitHub Actions için `CLOUDFLARE_API_TOKEN` ve
`CLOUDFLARE_ACCOUNT_ID` repository secret'larını ekleyip `main` dalına push etmek
yeterlidir. Sonrasında GitHub Pages frontend'i Worker API'ye bağlanır.
