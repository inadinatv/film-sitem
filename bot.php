<?php
header('Content-Type: application/json; charset=utf-8');

// Linkleri sitenin tam kullandığı orjinal halleriyle ekledik
$categories = [
    'turkce-dublaj-hd-film-izle' => 'Türkçe Dublaj',
    'altyazili-filmler' => 'Altyazılı Filmler',
    'film-tur/aksiyon' => 'Aksiyon',
    'film-tur/bilim-kurgu' => 'Bilim Kurgu',
    'film-tur/komedi' => 'Komedi',
    'film-tur/korku' => 'Korku',
    'film-tur/gerilim' => 'Gerilim',
    'film-tur/animasyon' => 'Animasyon',
    'film-tur/macera' => 'Macera',
    'film-tur/savas' => 'Savaş',
    'film-tur/tarih' => 'Tarih',
    'film-tur/suc' => 'Suç',
    'film-tur/dram' => 'Dram',
    'film-tur/aile' => 'Aile',
    'film-tur/fantastik' => 'Fantastik',
    'film-tur/gizem' => 'Gizem'
];

$moviesArray = [];

foreach ($categories as $path => $catName) {
    // Timeout (zaman aşımı) yememek için ilk etapta her kategoriden 1 sayfa çekiyoruz
    for ($i = 1; $i <= 1; $i++) { 
        $url = "https://www.filmmodu.one/$path?page=$i";
        
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept: text/html,application/xhtml+xml',
            'Accept-Language: tr-TR,tr;q=0.9'
        ]);
        $html = curl_exec($ch);
        curl_close($ch);

        // YENİ NESİL KURŞUNGEÇİRMEZ REGEX: Div veya tasarım fark etmeksizin direkt filmi bulur
        preg_match_all('#<a href="https://www.filmmodu.one/([^"]+)".*?data-src="([^"]+)".*?<span class="turkish-name">(.*?)</span>#si', $html, $matches, PREG_SET_ORDER);

        if (count($matches) > 0) {
            foreach ($matches as $m) {
                $id = trim($m[1], '/');
                if ($id && !isset($moviesArray[$id])) {
                    
                    // Yılı ayrı çekiyoruz (yoksa 2024 varsayacak)
                    preg_match('#<a href="https://www.filmmodu.one/' . preg_quote($id) . '".*?<p class="top">(\d{4})#si', $html, $yearMatch);
                    $year = isset($yearMatch[1]) ? $yearMatch[1] : '2024';

                    $moviesArray[$id] = [
                        "id" => $id,
                        // HTML etiketlerini (varsa) temizle
                        "title" => trim(strip_tags($m[3])), 
                        "image" => trim($m[2]),
                        "year" => $year,
                        "category" => $catName
                    ];
                }
            }
        }
    }
}

file_put_contents('movies.json', json_encode(array_values($moviesArray), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));

// Ekrana kaç film çektiğini yazdıracak (GitHub Actions loglarında görebilmen için)
echo "Bot kusursuz çalıştı! Toplam çekilen film sayısı: " . count($moviesArray);
?>
