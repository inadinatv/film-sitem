export default async function handler(req, res) {
  const { id, vid, trackUrl } = req.query;

  // 1. ÖZEL ALTYAZI PROXY SİSTEMİ (CORS ENGELİNİ KIRAR)
  if (trackUrl) {
      try {
          const trkRes = await fetch(trackUrl);
          const trkTxt = await trkRes.text();
          res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
          res.setHeader('Access-Control-Allow-Origin', '*');
          return res.status(200).send(trkTxt);
      } catch(e) {
          return res.status(500).send("");
      }
  }

  // 2. NORMAL VİDEO ÇEKİM İŞLEMİ
  if (!id) return res.status(400).send("Film ID eksik.");

  try {
    const pageReq = await fetch(`https://www.filmmodu.one/${id}`, { headers: { "user-agent": "Mozilla/5.0", "referer": "https://www.filmmodu.one/" } });
    const html = await pageReq.text();
    
    const vId = vid || (html.match(/videoId\s*=\s*'([^']+)'/) || html.match(/data-movie-id="([^"]+)"/) || [])[1];
    const csrf = (html.match(/"csrf-token" content="(.*?)"/) || [])[1];

    if (!vId || !csrf) return res.status(500).send("Video engeli veya dil ID'si bulunamadı.");

    const sourceReq = await fetch(`https://www.filmmodu.one/get-source?movie_id=${vId}&type=en`, {
      headers: { "x-csrf-token": csrf, "x-requested-with": "XMLHttpRequest", "referer": `https://www.filmmodu.one/${id}` }
    });
    
    const data = await sourceReq.json();
    if (!data.sources || data.sources.length === 0) return res.status(404).send("Link bulunamadı.");
    const videoUrl = data.sources[data.sources.length - 1].src;

    let tracks = "";
    if (data.tracks) {
        data.tracks.forEach(t => {
            if (t.kind === 'captions' || t.kind === 'subtitles') {
                // Altyazı linkini doğrudan vermek yerine, yukarıdaki Proxy sistemimize yönlendiriyoruz!
                const proxyUrl = `/api/play?trackUrl=${encodeURIComponent(t.file)}`;
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
        <title>İnadına TV Player</title>
        <link rel="stylesheet" href="https://cdn.plyr.io/3.7.8/plyr.css" />
        <style>body { margin:0; background:#000; overflow:hidden; } video { width:100vw; height:100vh; } :root { --plyr-color-main: #e50914; }</style>
    </head>
    <body>
        <video id="player" playsinline controls crossorigin>
            ${tracks}
        </video>
        <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
        <script src="https://cdn.plyr.io/3.7.8/plyr.polyfilled.js"></script>
        <script>
            const v = document.querySelector('video');
            const src = '${videoUrl}';
            const opts = { 
                captions: { active: true, language: 'tr', update: true }, 
                seekTime: 10 
            };
            if (Hls.isSupported() && src.includes('m3u8')) {
                const hls = new Hls(); 
                hls.loadSource(src); 
                hls.attachMedia(v);
                hls.on(Hls.Events.MANIFEST_PARSED, () => new Plyr(v, opts));
            } else { 
                v.src = src; 
                new Plyr(v, opts); 
            }
        </script>
    </body>
    </html>`);
  } catch (e) { res.status(500).send("Hata: " + e.message); }
}
