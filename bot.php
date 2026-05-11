<?php
header('Content-Type: application/json; charset=utf-8');

// Türkçe Dublaj ve Altyazılı dahil TÜM kategorileri isimlendirerek ekledik
$categories = [
    'turkce-dublaj-hd-film-izle' => 'Türkçe Dublaj',
    'altyazili-filmler' => 'Altyazılı Filmler',
    '4k' => '4K Kalite',
    'aile' => 'Aile',
    'aksiyon' => 'Aksiyon',
    'animasyon' => 'Animasyon',
    'belgesel' => 'Belgesel',
    'bilim-kurgu' => 'Bilim Kurgu',
    'dram' => 'Dram',
    'fantastik' => 'Fantastik',
    'gerilim' => 'Gerilim',
    'gizem' => 'Gizem',
    'hint-filmleri' => 'Hint Filmleri',
    'kisa-film' => 'Kısa Film',
    'komedi' => 'Komedi',
    'korku' => 'Korku',
    'kult-filmler' => 'Kült Filmler',
    'macera' => 'Macera',
    'muzik' => 'Müzik',
    'oscar-odullu-filmler' => 'Oscar Ödüllü',
    'romantik' => 'Romantik',
    'savas' => 'Savaş',
    'stand-up' => 'Stand Up',
    'suc' => 'Suç',
    'tarih' => 'Tarih',
    'tavsiye-filmler' => 'Tavsiye Filmler',
    'tv-film' => 'TV Film',
    'vahsi-bati' => 'Vahşi Batı'
];

$moviesArray = [];

foreach ($categories as $slug => $catName) {
    for ($i = 1; $i <= 2; $i++) { 
        // Dublaj ve Altyazı ana dizinde, diğerleri film-tur dizininde
        if ($slug === 'turkce-dublaj-hd-film-izle' || $slug === 'altyazili-filmler') {
            $url = "https://www.filmmodu.one/$slug?page=$i";
        } else {
            $url = "https://www.filmmodu.one/film-tur/$slug?page=$i";
        }
        
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, ['User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)']);
        $html = curl_exec($ch);
        curl_close($ch);

        preg_match_all('#<div class="col-md-2 col-xs-6 movie">(.*?)</div>\s*</div>#si', $html, $movies);

        if (isset($movies[1])) {
            foreach ($movies[1] as $movieHtml) {
                preg_match('#<a href="https://www.filmmodu.one/([^"]+)">#', $movieHtml, $linkMatch);
                preg_match('#data-src="(.*?)"#', $movieHtml, $logo);
                preg_match('#<span class="turkish-name">(.*?)</span>#', $movieHtml, $turkishName);
                preg_match('#<p class="top">(\d{4})#', $movieHtml, $year);

                $id = isset($linkMatch[1]) ? trim($linkMatch[1], '/') : '';
                if ($id && !isset($moviesArray[$id])) {
                    $moviesArray[$id] = [
                        "id" => $id,
                        "title" => trim($turkishName[1] ?? 'İsimsiz Film'),
                        "image" => $logo[1] ?? '',
                        "year" => $year[1] ?? '2024',
                        "category" => $catName
                    ];
                }
            }
        }
    }
}
file_put_contents('movies.json', json_encode(array_values($moviesArray), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
echo "Bot güncellendi. Türkçe Dublaj dahil tüm filmler başarıyla çekildi.";
?>
