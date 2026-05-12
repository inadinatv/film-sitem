export default async function handler(req, res) {
    const { url } = req.query;
    if (!url) return res.status(400).send("URL eksik.");

    try {
        // Linki çöz ve tamir et
        let finalUrl = decodeURIComponent(url);
        if (finalUrl.startsWith('//')) finalUrl = 'https:' + finalUrl;
        else if (!finalUrl.startsWith('http')) finalUrl = 'https://www.filmmodu.one' + finalUrl;

        // Karşı sunucuya gerçek bir tarayıcı gibi gidip altyazıyı kopar
        const response = await fetch(finalUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Referer": "https://www.filmmodu.one/"
            }
        });

        if (!response.ok) return res.status(404).send("Altyazı bulunamadı.");

        let text = await response.text();

        // KUSURSUZ ÇEVİRİ: SRT formatını (virgüllü) modern VTT formatına (noktalı) dönüştür
        if (!text.includes('WEBVTT')) {
            text = text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2'); // Virgülleri noktaya çevirir
            text = "WEBVTT\n\n" + text; // En başa zorunlu etiketi ekler
        }

        // Tarayıcı engelini kaldıran özel başlıklar (CORS Bypass)
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
        res.status(200).send(text);
    } catch (error) {
        res.status(500).send("");
    }
}
