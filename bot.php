<?php
/**
 * İnadına TV - Filmmodu Botu
 * --------------------------
 * filmmodu.one katalogunu tarar ve movies.json arsivini gunceller.
 *
 * Kullanim:
 *   php bot.php           -> Kategori taramasi (yeni filmler + alan onarimi)
 *   php bot.php tamir     -> Bozuk/eksik filmleri detay sayfasindan onarir
 *
 * Ozellikler:
 *  - Eski filmler asla silinmez (arsiv buyumeye devam eder)
 *  - Yeni bulunan filme "added" (eklenme tarihi) alani eklenir
 *  - movies.json her zaman EN YENI EKLENEN FILM EN USTTE olacak sekilde yazilir
 *  - Basligi bos film kalmaz: Turkce ad > orijinal ad > slug'dan uretilen ad
 *  - Listeleme sayfasi "eklenme tarihine gore" siralandigi icin, ust uste
 *    3 sayfa boyunca hic yeni/degisen film gorulmeyince kategori erken bitirilir
 *    (gunluk calistirmalarda sureyi cok kisaltir)
 */

set_time_limit(0);
ini_set('memory_limit', '-1');

if (php_sapi_name() !== 'cli') {
    header('Content-Type: text/plain; charset=utf-8');
}

define('SITE', 'https://www.filmmodu.one');

// normal : yeni filmler + hizli gunluk tarama (erken durdurma aktif)
// derin  : erken durdurma yok, tum arsiv bastan taranir (haftada bir onerilir)
// tamir  : bozuk/eksik kayitlar detay sayfasindan onarilir
$mod      = isset($argv[1]) ? strtolower(trim($argv[1])) : 'normal';
$earlyStop = ($mod !== 'derin');
$jsonFile = __DIR__ . '/movies.json';

$categories = [
    'turkce-dublaj-hd-film-izle'      => 'Türkçe Dublaj',
    'turkce-altyazili-hd-filmler-izle'=> 'Altyazılı Filmler',
    'film-tur/4k-film-izle'           => '4K',
    'film-tur/aile-filmleri'          => 'Aile',
    'film-tur/aksiyon'                => 'Aksiyon',
    'film-tur/animasyon'              => 'Animasyon',
    'film-tur/belgeseller'            => 'Belgesel',
    'film-tur/bilim-kurgu-filmleri'   => 'Bilim-Kurgu',
    'film-tur/dram-filmleri'          => 'Dram',
    'film-tur/fantastik-filmler'      => 'Fantastik',
    'film-tur/gerilim'                => 'Gerilim',
    'film-tur/gizem-filmleri'         => 'Gizem',
    'film-tur/hd-hint-filmleri'       => 'Hint Filmleri',
    'film-tur/kisa-film'              => 'Kısa Film',
    'film-tur/hd-komedi-filmleri'     => 'Komedi',
    'film-tur/korku-filmleri'         => 'Korku',
    'film-tur/kult-filmler-izle'      => 'Kült Filmler',
    'film-tur/macera-filmleri'        => 'Macera',
    'film-tur/muzik'                  => 'Müzik',
    'film-tur/odullu-filmler-izle'    => 'Oscar Ödüllü Filmler',
    'film-tur/romantik-filmler'       => 'Romantik',
    'film-tur/savas-filmleri'         => 'Savaş',
    'film-tur/stand-up'               => 'Stand Up',
    'film-tur/suc-filmleri'           => 'Suç',
    'film-tur/tarih'                  => 'Tarih',
    'film-tur/tavsiye-filmler'        => 'Tavsiye Filmler',
    'film-tur/tv-film'                => 'TV filmi',
    'film-tur/vahsi-bati-filmleri'    => 'Vahşi Batı',
];

/* ------------------------------------------------------------------ */
/* Yardimci fonksiyonlar                                               */
/* ------------------------------------------------------------------ */

function fm_request($url, $timeout = 20) {
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, $timeout);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept: text/html,application/xhtml+xml',
        'Accept-Language: tr-TR,tr;q=0.9',
    ]);
    $html      = curl_exec($ch);
    $httpcode  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$html === false ? '' : $html, $httpcode];
}

function fm_clean($s) {
    $s = trim(strip_tags((string)$s));
    $s = html_entity_decode($s, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    return trim(preg_replace('/\s+/u', ' ', $s));
}

function fm_poster_num($image) {
    if (preg_match('#/poster/(\d+)/#', (string)$image, $m)) {
        return (int)$m[1];
    }
    return 0;
}

function fm_valid_id($id) {
    // Film sayfalarinin tamami "-film-izle" ile biter; enjeksiyon riski
    // tasiyan karakterleri ve film disi linkleri (orn: giris, kategori, 4k-film-izle) ele.
    if (!preg_match('/-film-izle$/', $id)) return false;
    if (preg_match('/[\s"\'<>\\\\]/', $id)) return false;
    if (strpos($id, '/') !== false) return false; // film-tur/ veya alt yollar film degildir
    if (in_array($id, ['turkce-dublaj-hd-film-izle', 'turkce-altyazili-hd-filmler-izle', '4k-film-izle'], true)) return false;
    return true;
}

/** Karsilastirma icin basliklari normalize eder (noktalama/bosluk duyarsiz). */
function fm_norm($s) {
    return strtolower(preg_replace('/[^a-z0-9]/i', '', (string)$s));
}

function fm_title_from_slug($id) {
    $slug  = preg_replace('/-film-izle$/', '', $id);
    $slug  = strtolower($slug);
    $small = ['of','the','a','an','and','or','but','in','on','at','to','for','by','with','from','vs'];
    $words = explode('-', $slug);
    $out   = [];
    $last  = count($words) - 1;
    foreach ($words as $i => $w) {
        if ($w === '') continue;
        if ($i > 0 && $i < $last && in_array($w, $small, true)) {
            $out[] = $w;
        } else {
            $out[] = mb_convert_case($w, MB_CASE_TITLE, 'UTF-8');
        }
    }
    $t = implode(' ', $out);
    return $t !== '' ? $t : 'Film';
}

/**
 * Listeleme sayfasini film kartlarina boler.
 * Her kart icin: id, image, title (turkce ad yoksa orijinal ad), year.
 */
function fm_parse_listing($html) {
    $cards = [];
    if (!preg_match_all(
        '#<a[^>]+href="https://www\.filmmodu\.one/([^"]+?)"#i',
        $html, $am, PREG_OFFSET_CAPTURE
    )) {
        return $cards;
    }

    $anchors = [];
    foreach ($am[1] as $hit) {
        // Sadece gercek film sayfalarinin linkleri kabul edilir
        // Film sayfasi -film-izle ile biter ve film-tur, turkce-dublaj vb. kategori/sayfa slug'larini icermez
        $id = trim($hit[0], "/ \t\n\r\0\x0B");
        if (fm_valid_id($id)) {
            $anchors[] = [$id, $hit[1]];
        }
    }

    $count = count($anchors);
    for ($i = 0; $i < $count; $i++) {
        list($id, $start) = $anchors[$i];
        $end   = ($i + 1 < $count) ? $anchors[$i + 1][1] : $start + 4000;
        $block = substr($html, $start, min($end, $start + 4000) - $start);

        // Poster
        $image = '';
        if (preg_match('#data-src="([^"]+)"#i', $block, $m)) {
            $image = trim($m[1]);
        } elseif (preg_match('#<img[^>]+src="([^"]+)"#i', $block, $m)) {
            $image = trim($m[1]);
        }
        if ($image !== '' && strpos($image, '//') === 0) {
            $image = 'https:' . $image;
        }

        // Ad: once Turkce ad, yoksa orijinal ad (birden fazla desen denenir)
        $tr = '';
        if (preg_match('#<span class="turkish-name"[^>]*>(.*?)</span>#si', $block, $m)) {
            $tr = fm_clean($m[1]);
        }
        $orig = '';
        $origPatterns = [
            '#<span class="name"[^>]*>(.*?)</span>#si',
            '#<h3[^>]*>(.*?)</h3>#si',
            '#<h2[^>]*>(.*?)</h2>#si',
            '#<img[^>]+\salt="([^"]+)"#i',
            '#<a[^>]+\stitle="([^"]+)"#i',
        ];
        foreach ($origPatterns as $p) {
            if (preg_match($p, $block, $m)) {
                $c = fm_clean($m[1]);
                if ($c !== '' && !preg_match('/izle$/iu', $c)) {
                    $orig = $c;
                    break;
                }
            }
        }

        $title = $tr !== '' ? $tr : ($orig !== '' ? $orig : fm_title_from_slug($id));

        // Yil
        $year = '';
        if (preg_match('#<p class="top"[^>]*>\s*(\d{4})#si', $block, $m)) {
            $year = $m[1];
        } elseif (preg_match('#film-yil/(\d{4})#', $block, $m)) {
            $year = $m[1];
        }

        // Afis kontrolu: Gecerli poster resmi olmayan veya bos kartlar eklenmez
        if ($image === '' || fm_poster_num($image) === 0) {
            continue;
        }

        $cards[] = [
            'id'    => $id,
            'image' => $image,
            'title' => $title,
            'year'  => $year,
        ];
    }
    return $cards;
}

/** Arsivi "en yeni eklenen en ustte" siralamasiyla diske yazar. */
function fm_save($moviesArray, $jsonFile) {
    $values = array_values($moviesArray);
    usort($values, function ($a, $b) {
        return fm_poster_num($b['image']) <=> fm_poster_num($a['image']);
    });
    file_put_contents(
        $jsonFile,
        json_encode($values, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)
    );
}

/* ------------------------------------------------------------------ */
/* 1. HAFIZA: Eski filmleri asla silme, bellege al                     */
/* ------------------------------------------------------------------ */

$moviesArray = [];
if (file_exists($jsonFile)) {
    $existingData = json_decode(file_get_contents($jsonFile), true);
    if (is_array($existingData)) {
        foreach ($existingData as $movie) {
            if (isset($movie['id'])) {
                $moviesArray[$movie['id']] = $movie;
            }
        }
    }
}

/* ------------------------------------------------------------------ */
/* TAMIR MODU: bozuk/basligi eksik filmleri detay sayfasindan onar    */
/* ------------------------------------------------------------------ */

if ($mod === 'tamir') {
    $targets = [];
    foreach ($moviesArray as $id => $m) {
        $title   = isset($m['title']) ? trim($m['title']) : '';
        $titleOk = $title !== '' && strpos($title, '&#') === false;
        $imageOk = fm_poster_num(isset($m['image']) ? $m['image'] : '') > 0;
        // Baslik slug'dan uretilmise birebir aynidir; detay sayfasindan
        // gercek basliga (orn: "Tron Ares" -> "Tron: Ares") cevrilebilir.
        $slugTitle = ($title !== '' && fm_norm($title) === fm_norm(fm_title_from_slug($id)));
        if (!$titleOk || !$imageOk || $slugTitle) {
            $targets[] = $id;
        }
    }

    $limit = 500; // tek seferde en fazla bu kadar film onarilir
    $targets = array_slice($targets, 0, $limit);
    $fixed = 0;
    $done  = 0;

    foreach ($targets as $id) {
            list($html, $code) = fm_request(SITE . '/' . $id);
            if ($code == 404 || strpos($html, 'Sayfa Bulunamadı') !== false || strpos($html, 'BULUNAMADI!') !== false) {
                // Kaynak sitede film yok veya silinmis: arsivden temizle
                unset($moviesArray[$id]);
                $fixed++;
                $done++;
                continue;
            }
            if ($code == 200 && $html !== '') {
            $m = &$moviesArray[$id];

            if (preg_match('/<meta property="og:title" content="([^"]+)"/i', $html, $t)) {
                $title = fm_clean($t[1]);
                $title = preg_replace('/\s*(izle|hd film izle|film izle|full izle).*$/iu', '', $title);
                $title = trim($title);

                $curTitle = isset($m['title']) ? trim($m['title']) : '';
                $curBad   = ($curTitle === '' || strpos($curTitle, '&#') !== false);
                $curSlug  = ($curTitle !== '' && fm_norm($curTitle) === fm_norm(fm_title_from_slug($id)));

                if ($title !== '' && ($curBad || ($curSlug && fm_norm($title) !== fm_norm($curTitle)))) {
                    $m['title'] = $title;
                    $fixed++;
                }
            }

            if (fm_poster_num(isset($m['image']) ? $m['image'] : '') === 0) {
                if (preg_match('/<meta property="og:image" content="([^"]+)"/i', $html, $im)) {
                    $m['image'] = trim($im[1]);
                    $fixed++;
                } elseif (preg_match('#(https://cdn\.filmmodu\.one/uploads/movie/poster/\d+/[^"\']+)#i', $html, $im)) {
                    $m['image'] = trim($im[1]);
                    $fixed++;
                }
            }

            if (preg_match('#film-yil/(\d{4})#', $html, $y)) {
                $m['year'] = $y[1];
            }
            unset($m);
        }
        $done++;
        if ($done % 25 === 0) {
            fm_save($moviesArray, $jsonFile);
        }
        usleep(rand(300000, 500000));
    }

    fm_save($moviesArray, $jsonFile);
    echo "Tamir tamamlandi! Kontrol edilen: $done | Duzeltilen alan: $fixed | Toplam arsiv: " . count($moviesArray);
    exit;
}

/* ------------------------------------------------------------------ */
/* NORMAL MOD: kategorileri tara                                       */
/* ------------------------------------------------------------------ */

$baslangic_sayisi = count($moviesArray);

foreach ($categories as $path => $catName) {
    $i           = 1;
    $lastPageIds = [];
    $knownStreak = 0; // ust uste tamamen bilinen sayfa sayaci

    while (true) {
        $url = SITE . "/$path?page=$i";
        list($html, $httpcode) = fm_request($url);

        // Kategori bittiyse veya site hata verirse diger kategoriye gec
        if ($httpcode != 200 || $html === '') {
            break;
        }

        $cards = fm_parse_listing($html);
        if (count($cards) === 0) {
            break;
        }

        // SAYFA TEKRARI KONTROLU: site ayni sayfayi tekrar veriyorsa dur
        $currentPageIds = array_column($cards, 'id');
        if ($currentPageIds === $lastPageIds) {
            break;
        }
        $lastPageIds = $currentPageIds;

        $pageNew = 0;
        $pageUpd = 0;

        foreach ($cards as $card) {
            $id = $card['id'];

            if (!isset($moviesArray[$id])) {
                // Yeni film: eklenme tarihini not et
                $moviesArray[$id] = [
                    'id'       => $id,
                    'title'    => $card['title'],
                    'image'    => $card['image'],
                    'year'     => $card['year'] !== '' ? $card['year'] : date('Y'),
                    'category' => $catName,
                    'added'    => date('Y-m-d'),
                ];
                $pageNew++;
            } else {
                // Kayitli film: eksik alanlari firsat bu firsat onar
                $cur     = &$moviesArray[$id];
                $changed = false;

                if ((!isset($cur['title']) || trim($cur['title']) === '') && $card['title'] !== '') {
                    $cur['title'] = $card['title'];
                    $changed = true;
                }
                if (fm_poster_num(isset($cur['image']) ? $cur['image'] : '') === 0 && fm_poster_num($card['image']) > 0) {
                    $cur['image'] = $card['image'];
                    $changed = true;
                }
                if ((!isset($cur['year']) || $cur['year'] === '') && $card['year'] !== '') {
                    $cur['year'] = $card['year'];
                    $changed = true;
                }
                if ($changed) {
                    $pageUpd++;
                }
                unset($cur);
            }
        }

        // CANLI KAYIT: her sayfa gecisinde emegi aninda kaydet
        fm_save($moviesArray, $jsonFile);

        // ERKEN DUR: liste eklenme tarihine gore sirali oldugu icin ust uste
        // 3 sayfa boyunca hicbir sey degismiyorsa kalan sayfalar da aynidir.
        // ("derin" modda kapali: eski gozden kacan filmler de taranir)
        if ($earlyStop && $pageNew === 0 && $pageUpd === 0) {
            $knownStreak++;
            if ($knownStreak >= 3) {
                break;
            }
        } else {
            $knownStreak = 0;
        }

        // Anti-spam: insan gibi davran
        usleep(rand(250000, 550000));
        $i++;
    }
}

$bitis_sayisi = count($moviesArray);
$eklenen_film = $bitis_sayisi - $baslangic_sayisi;

echo "Tarama tamamlandi! Yeni eklenen film: $eklenen_film | Toplam arsiv: $bitis_sayisi";
