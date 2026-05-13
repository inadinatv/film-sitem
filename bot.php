<?php
set_time_limit(0); 
ini_set('memory_limit', '-1');

header('Content-Type: application/json; charset=utf-8');

$categories = [
    'turkce-dublaj-hd-film-izle' => 'Türkçe Dublaj',
    'altyazili-filmler' => 'Altyazılı Filmler',
    'film-tur/4k' => '4K',
    'film-tur/aile' => 'Aile',
    'film-tur/aksiyon' => 'Aksiyon',
    'film-tur/animasyon' => 'Animasyon',
    'film-tur/belgesel' => 'Belgesel',
    'film-tur/bilim-kurgu' => 'Bilim-Kurgu',
    'film-tur/dram' => 'Dram',
    'film-tur/fantastik' => 'Fantastik',
    'film-tur/gerilim' => 'Gerilim',
    'film-tur/gizem' => 'Gizem',
    'film-tur/hint-filmleri' => 'Hint Filmleri',
    'film-tur/kisa-film' => 'Kısa Film',
    'film-tur/komedi' => 'Komedi',
    'film-tur/korku' => 'Korku',
    'film-tur/kult-filmler' => 'Kült Filmler',
    'film-tur/macera' => 'Macera',
    'film-tur/muzik' => 'Müzik',
    'film-tur/oscar-odullu-filmler' => 'Oscar Ödüllü Filmler',
    'film-tur/romantik' => 'Romantik',
    'film-tur/savas' => 'Savaş',
    'film-tur/stand-up' => 'Stand Up',
    'film-tur/suc' => 'Suç',
    'film-tur/tarih' => 'Tarih',
    'film-tur/tavsiye-filmler' => 'Tavsiye Filmler',
    'film-tur/tv-film' => 'TV filmi',
    'film-tur/vahsi-bati' => 'Vahşi Batı'
];

$moviesArray = [];
$max_page_limit = 8; // GÜVENLİ SINIR: Her kategori için en güncel 8 sayfa taranır

foreach ($categories as $path => $catName) {
    $i = 1; 
    
    while ($i <= $max_page_limit) { 
        $url = "https://www.filmmodu.one/$path?page=$i";
        
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 15); // Sunucu yanıt vermezse 15 saniyede iptal et
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept: text/html,application/xhtml+xml',
            'Accept-Language: tr-TR,tr;q=0.9'
        ]);
        $html = curl_exec($ch);
        $httpcode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        // Site bota engel attıysa (403 veya 404 hatası) o kategoriyi es geç
        if ($httpcode != 200) {
            break;
        }

        preg_match_all('#<a href="https://www.filmmodu.one/([^"]+)".*?data-src="([^"]+)".*?<span class="turkish-name">(.*?)</span>#si', $html, $matches, PREG_SET_ORDER);

        // O sayfada hiç film yoksa döngüyü kır
        if (count($matches) === 0) {
            break; 
        }

        $newMoviesCount = 0;

        foreach ($matches as $m) {
            $id = trim($m[1], '/');
            
            if ($id && !isset($moviesArray[$id])) {
                preg_match('#<a href="https://www.filmmodu.one/' . preg_quote($id) . '".*?<p class="top">(\d{4})#si', $html, $yearMatch);
                $year = isset($yearMatch[1]) ? $yearMatch[1] : '2024';

                $moviesArray[$id] = [
                    "id" => $id,
                    "title" => trim(strip_tags($m[3])), 
                    "image" => trim($m[2]),
                    "year" => $year,
                    "category" => $catName
                ];
                $newMoviesCount++;
            }
        }
        
        // Yeni bir film eklenmediyse, aynı sayfa tekrar ediyordur, diğer kategoriye geç
        if ($newMoviesCount === 0) {
            break; 
        }

        // ANTİ-SPAM KORUMASI: Siteyi şüphelendirmemek için iki istek arasına 0.5 ile 1 saniye arası rastgele bekleme
        usleep(rand(500000, 1000000)); 
        $i++;
    }
}

file_put_contents('movies.json', json_encode(array_values($moviesArray), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));

echo "Bot güvenli ve optimize modda tamamlandı! Çekilen toplam film sayısı: " . count($moviesArray);
?>
