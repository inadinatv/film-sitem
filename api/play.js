export default async function handler(req, res) {
  const { id, vid, lang } = req.query;

  if (!id) return res.status(400).send("Film ID eksik.");

  try {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"; 
    const pageReq = await fetch(`https://www.filmmodu.one/${id}`, { headers: { "user-agent": ua, "referer": "https://www.filmmodu.one/" } });
    const html = await pageReq.text();
    const cookies = pageReq.headers.get('set-cookie') || "Yok"; 
    
    const vId = vid || (html.match(/videoId\s*=\s*'([^']+)'/) || html.match(/data-movie-id="([^"]+)"/) || [])[1];
    const csrf = (html.match(/"csrf-token" content="(.*?)"/) || [])[1];

    if (!vId || !csrf) return res.status(500).send("Video ID bulunamadı.");

    const targetLang = lang === 'en' ? 'en' : 'tr';
    let data = null;
    let url = `https://www.filmmodu.one/get-source?movie_id=${vId}&type=${targetLang}`;
    
    const sourceReq = await fetch(url, {
        headers: { "x-csrf-token": csrf, "x-requested-with": "XMLHttpRequest", "cookie": cookies, "user-agent": ua, "referer": `https://www.filmmodu.one/${id}` }
    });
    
    try {
        data = await sourceReq.json();
    } catch(e) {
        data = { error: "JSON Çözülemedi veya Cloudflare Engeli", message: e.message };
    }

    // EKRANA RÖNTGEN VERİSİNİ BASIYORUZ
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`
    <html>
    <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Sistem Röntgeni</title>
    </head>
    <body style="background:#111; color:#0f0; font-family:monospace; padding:15px; font-size:13px; word-wrap: break-word;">
        <h2 style="color:white;">🛠️ SİSTEM RÖNTGENİ 🛠️</h2>
        <p><b>Aranan Dil:</b> ${targetLang}</p>
        <p><b>Video ID:</b> ${vId}</p>
        <hr style="border-color:#333;">
        <h3 style="color:yellow;">SUNUCUDAN GELEN HAM VERİ (DATA):</h3>
        <pre style="white-space: pre-wrap; background:#000; padding:10px; border:1px solid #333;">${JSON.stringify(data, null, 4)}</pre>
        <hr style="border-color:#333;">
        <p style="color:white;"><i>Burhan Usta, lütfen bu ekranın tamamını görebileceğim bir ekran resmi gönder. Tracks kısmı var mı yok mu ona bakacağız.</i></p>
    </body>
    </html>
    `);
  } catch (e) { res.status(500).send("Hata: " + e.message); }
}
