<?php
header('Content-Type: application/json; charset=utf-8');

$startPage = 1;
$endPage = 3; // Başlangıç için 3 sayfa çekiyoruz, sonra artırabilirsin
$moviesArray = [];

for ($i = $startPage; $i <= $endPage; $i++) {
    $url = "https://www.filmmodu.one/film-tur/aksiyon?page=$i";
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, array(
        'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    ));
    $html = curl_exec($ch);
    curl_close($ch);

    preg_match_all('#<div class="col-md-2 col-xs-6 movie">(.*?)</div>\s*</div>#si', $html, $movies);

    if (isset($movies[1])) {
        foreach ($movies[1] as $movieHtml) {
            preg_match('#<a href="https://www.filmmodu.one/([^"]+)">#', $movieHtml, $linkMatch);
            $filmLink = isset($linkMatch[1]) ? trim($linkMatch[1], '/') : '';

            preg_match('#data-src="(.*?)"#', $movieHtml, $logo);
            $filmLogo = $logo[1] ?? '';

            preg_match('#<span class="turkish-name">(.*?)</span>#', $movieHtml, $turkishName);
            $filmTurkish = trim($turkishName[1] ?? '');

            if ($filmLink && $filmTurkish) {
                $moviesArray[] = [
                    "id" => $filmLink,
                    "title" => $filmTurkish,
                    "image" => $filmLogo
                ];
            }
        }
    }
}
file_put_contents('movies.json', json_encode($moviesArray, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
echo "Bot calisti, movies.json olusturuldu.";
?>
