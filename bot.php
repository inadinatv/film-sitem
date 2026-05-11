<?php
header('Content-Type: application/json; charset=utf-8');

// Ekran görüntüsündeki TÜM kategoriler eklendi
$categories = [
    '4k', 'aile', 'aksiyon', 'animasyon', 'belgesel', 'bilim-kurgu', 'dram',
    'fantastik', 'gerilim', 'gizem', 'hint-filmleri', 'kisa-film', 'komedi',
    'korku', 'kult-filmler', 'macera', 'muzik', 'oscar-odullu-filmler',
    'romantik', 'savas', 'stand-up', 'suc', 'tarih', 'tavsiye-filmler',
    'tv-film', 'vahsi-bati'
];

$moviesArray = [];

foreach ($categories as $category) {
    for ($i = 1; $i <= 2; $i++) { // Hız ve güvenlik için her kategoriden ilk 2 sayfa
        $url = "https://www.filmmodu.one/film-tur/$category?page=$i";
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
                        // Linkteki '-' işaretlerini boşluğa çevirip baş harflerini büyütür (Örn: bilim-kurgu -> Bilim Kurgu)
                        "category" => ucwords(str_replace('-', ' ', $category)), 
                        "desc" => "Bu film için detaylar oynatıcı sayfasında otomatik güncellenmektedir." 
                    ];
                }
            }
        }
    }
}
file_put_contents('movies.json', json_encode(array_values($moviesArray), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
echo "Bot başarıyla çalıştı. Tüm kategorilerden filmler çekildi.";
?>
