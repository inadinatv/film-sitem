export default async function handler(req, res) {
  const { id, vid, trackUrl } = req.query;

  // 1. ALTYAZI PROXY SİSTEMİ
  if (trackUrl) {
    try {
      const trkRes = await fetch(trackUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Referer": "https://www.filmmodu.one/" }
      });
      let trkTxt = await trkRes.text();
      res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(200).send(trkTxt.includes('WEBVTT') ? trkTxt : "WEBVTT\n\n" + trkTxt);
    } catch(e) { return res.status(500).send(""); }
  }

  if (!id) return res.status(400).send("Film ID eksik.");

  try {
    // 2. SAYFAYA GİDİP ÇEREZLERİ (COOKIE) VE TOKEN'I ALIYORUZ
    const pageReq = await fetch(`https://www.filmmodu.one/${id}`, {
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "referer": "https://www.filmmodu.one/" }
    });
    
    const html = await pageReq.text();
    const cookies = pageReq.headers.get('set-cookie'); // Sunucunun verdiği kimlik kartı (çerez)

    const vId = vid || (html.match(/videoId\s*=\s*'([^']+)'/) || html.match(/data-movie-id="([^"]+)"/) || [])[1];
    const csrf = (html.match(/"csrf-token" content="(.*?)"/) || [])[1];

    if (!vId || !csrf) return res.status(500).send("Video ID veya Token bulunamadı. Lütfen sayfayı yenileyip tekrar deneyin.");

    // 3. ÇEREZLERLE BİRLİKTE KAYNAK İSTİYORUZ (Link Bulunamadı Hatasını Burası Çözer)
    const sourceReq = await fetch(`https://www.filmmodu.one/get-source?movie_id=${vId}`, {
      headers: {
        "x-csrf-token": csrf,
        "x-requested-with": "XMLHttpRequest",
        "cookie": cookies, // İşte sihirli dokunuş burası
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "referer": `https://www.filmmodu.one/${id}`,
        "accept": "application/json, text/javascript, */*; q=0.01"
      }
    });
    
    const data = await sourceReq.json();
    if (!data.sources || data.sources.length === 0) return res.status(404).send("Sunucu kaynak vermedi. Site koruması geçici olarak engellemiş olabilir.");
    
    const videoUrl = data.sources[data.sources.length - 1].src;

    // Altyazı yakalama
    let tracks = "";
    if (data.tracks) {
      data.tracks.forEach(t => {
        if (t.kind === 'captions' || t.kind === 'subtitles') {
          let trackFile = t.file || t.src;
          if (trackFile && !trackFile.startsWith('http')) trackFile = 'https://www.filmmodu.one' + trackFile;
          const proxyUrl = `/api/play?trackUrl=${encodeURIComponent(trackFile)}`;
          tracks += `<track kind="captions" label="${t.label || 'Türkçe'}" src="${proxyUrl}" srclang="tr" default />\n`;
        }
      });
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`
    <!DOCTYPE html>
    <html lang="tr">
    <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link rel="stylesheet" href="https://cdn.plyr.io/3.7.8/plyr.css" />
        <style>body { margin:0; background:#000; overflow:hidden; } video { width:100vw; height:100vh; } :root { --plyr-color-main: #e50914; }</style>
    </head>
    <body>
        <video id="player" playsinline controls crossorigin>${tracks}</video>
        <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
        <script src="https://cdn.plyr.io/3.7.8/plyr.polyfilled.js"></script>
        <script>
            const v = document.querySelector('video');
            const opts = { captions: { active: true, language: 'tr' }, seekTime: 10 };
            if (Hls.isSupported() && '${videoUrl}'.includes('m3u8')) {
                const hls = new Hls(); hls.loadSource('${videoUrl}'); hls.attachMedia(v);
                hls.on(Hls.Events.MANIFEST_PARSED, () => new Plyr(v, opts));
            } else { v.src = '${videoUrl}'; new Plyr(v, opts); }
        </script>
    </body>
    </html>`);
  } catch (e) { res.status(500).send("Sistem Hatası: " + e.message); }
}
