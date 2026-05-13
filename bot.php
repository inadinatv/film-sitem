<?php
set_time_limit(0); 
ini_set('memory_limit', '-1');

header('Content-Type: application/json; charset=utf-8');

// BÜTÜN LİNKLER VERDİĞİN LİSTEYE GÖRE GÜNCELLENDİ
$categories = [
    'turkce-dublaj-hd-film-izle' => 'Türkçe Dublaj',
    'altyazili-filmler' => 'Altyazılı Filmler',
    'film-tur/4k-film-izle' => '4K',
    'film-tur/aile-filmleri' => 'Aile',
    'film-tur/aksiyon' => 'Aksiyon',
    'film-tur/animasyon' => 'Animasyon',
    'film-tur/belgeseller' => 'Belgesel',
    'film-tur/bilim-kurgu-filmleri' => 'Bilim-Kurgu',
    'film-tur/dram-filmleri' => 'Dram',
    'film-tur/fantastik-filmler' => 'Fantastik',
    'film-tur/gerilim' => 'Gerilim',
    'film-tur/gizem-filmleri' => 'Gizem',
    'film-tur/hd-hint-filmleri' => 'Hint Filmleri',
    'film-tur/kisa-film' => 'Kısa Film',
    'film-tur/hd-komedi-filmleri' => 'Komedi',
    'film-tur/korku-filmleri' => 'Korku',
    'film-tur/kult-filmler-izle' => 'Kült Filmler',
    'film-tur/macera-filmleri' => 'Macera',
    'film-tur/muzik' => 'Müzik',
    'film-tur/odullu-filmler-izle' => 'Oscar Ödüllü Filmler',
    'film-tur/romantik-filmler' => 'Romantik',
    'film-tur/savas-filmleri' => 'Savaş',
    'film-tur/stand-up' => 'Stand Up',
    'film-tur/suc-filmleri' => 'Suç',
    'film-tur/tarih' => 'Tarih',
    'film-tur/tavsiye-filmler' => 'Tavsiye Filmler',
    'film-tur/tv-film' => 'TV filmi',
    'film-tur/vahsi-bati-filmleri' => 'Vahşi Batı'
];

$moviesArray = [];
$max_page_limit = 50; // Kategori başı 50 sayfa = Mükemmel arşiv dengesi

foreach ($categories as $path => $catName) {
    $i = 1; 
    
    while ($i <= $max_page_limit) { 
        $url = "https://www.filmmodu.one/$path?page=$i";
        
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 15); 
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept: text/html,application/xhtml+xml',
            'Accept-Language: tr-TR,tr;q=0.9'
        ]);
        $html = curl_exec($ch);
        $httpcode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        // Sunucu engel atarsa (403/404 vs) döngüyü zorlamadan sıradaki kategoriye geç
        if ($httpcode != 200) {
            break;
        }

        preg_match_all('#<a href="https://www.filmmodu.one/([^"]+)".*?data-src="([^"]+)".*?<span class="turkish-name">(.*?)</span>#si', $html, $matches, PREG_SET_ORDER);

        // Sayfa boşsa bitir
        if (count($matches) === 0) {
            break; 
        }

        $newMoviesCount = 0;

        foreach ($matches as $m) {
            $id = trim($m[1], '/');
            
            // Sadece listemizde olmayan yeni filmleri ekle
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
        
        // Bu sayfada yeni bir şey bulamadıysak döngüyü kır
        if ($newMoviesCount === 0) {
            break; 
        }

        // Anti-spam koruması: Her sayfa çekimi arası ufak bir mola
        usleep(rand(300000, 700000)); 
        $i++;
    }
}

// Tüm veriyi json dosyasına kaydet
file_put_contents('movies.json', json_encode(array_values($moviesArray), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));

echo "Bot devasa arşivi güncel linklerle başarıyla çekti! Toplam film sayısı: " . count($moviesArray);
?>
