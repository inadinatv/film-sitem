export default async function handler(req, res) {
  const { id, vid, trackUrl } = req.query;

  // 1. ALTYAZI PROXY SİSTEMİ
  if (trackUrl) {
      try {
          const trkRes = await fetch(trackUrl, {
              headers: {
                  "User-Agent": "Mozilla/5.0 (Web0S; Linux/SmartTV)",
                  "Referer": "https://www.filmmodu.one/"
              }
          });
          let trkTxt = await trkRes.text();
          res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
          res.setHeader('Access-Control-Allow-Origin', '*');
          return res.status(200).send(trkTxt.includes('WEBVTT') ? trkTxt : "WEBVTT\n\n" + trkTxt);
      } catch(e) { return res.status(500).send(""); }
  }

  if (!id) return res.status(400).send("Film ID eksik.");

  try {
    // CLOUDFLARE ENGELİNİ AŞAN SİHİRLİ KİMLİK
    const ua = "Mozilla/5.0 (Web0S; Linux/SmartTV)"; 
    
    const pageReq = await fetch(`https://www.filmmodu.one/${id}`, {
      headers: { "user-agent": ua, "referer": "https://www.filmmodu.one/" }
    });
    
    const html = await pageReq.text();
    const vId = vid || (html.match(/videoId\s*=\s*'([^']+)'/) || html.match(/data-movie-id="([^"]+)"/) || [])[1];
    const csrf = (html.match(/"csrf-token" content="(.*?)"/) || [])[1];

    if (!vId || !csrf) return res.status(500).send("Video ID veya Token bulunamadı. Sayfayı yenileyin.");

    // 2. AKILLI DİL VE LİNK BULUCU (Önce Türkçe, Sonra İngilizce Dener)
    let data = null;
    const typesToTry = ['tr', 'en', '']; 
    
    for (let t of typesToTry) {
        let url = `https://www.filmmodu.one/get-source?movie_id=${vId}`;
        if (t) url += `&type=${t}`;
        
        const sourceReq = await fetch(url, {
          headers: {
            "x-csrf-token": csrf,
            "x-requested-with": "XMLHttpRequest",
            "user-agent": ua,
            "referer": `https://www.filmmodu.one/${id}`
          }
        });
        
        try {
            const tempData = await sourceReq.json();
            if (tempData.sources && tempData.sources.length > 0) {
                data = tempData;
                break; // Linki bulduğu an aramayı durdurur ve videoyu çeker!
            }
        } catch(e) { /* Hata olursa sıradaki dile geçer */ }
    }

    if (!data || !data.sources || data.sources.length === 0) {
        return res.status(404).send("Sunucu kaynak vermedi. Site koruması geçici olarak engellemiş olabilir.");
    }
    
    const videoUrl = data.sources[data.sources.length - 1].src;

    // 3. ALTYAZILARI VİDEOYA GÖMME
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

    // 4. OYNATICIYI (PLAYER) EKRANA ÇİZME
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`
    <!DOCTYPE html>
    <html lang="tr">
    <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>İnadına TV Player</title>
        <link rel="stylesheet" href="https://cdn.plyr.io/3.7.8/plyr.css" />
        <style>body { margin:0; background:#000; overflow:hidden; } video { width:100vw; height:100vh; } :root { --plyr-color-main: #e50914; }</style>
    </head>
    <body>
        <video id="player" playsinline controls crossorigin>${tracks}</video>
        <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
        <script src="https://cdn.plyr.io/3.7.8/plyr.polyfilled.js"></script>
        <script>
            const v = document.querySelector('video');
            const opts = { captions: { active: true, language: 'tr', update: true }, seekTime: 10 };
            if (Hls.isSupported() && '${videoUrl}'.includes('m3u8')) {
                const hls = new Hls(); hls.loadSource('${videoUrl}'); hls.attachMedia(v);
                hls.on(Hls.Events.MANIFEST_PARSED, () => new Plyr(v, opts));
            } else { v.src = '${videoUrl}'; new Plyr(v, opts); }
        </script>
    </body>
    </html>`);
  } catch (e) { res.status(500).send("Hata: " + e.message); }
}
