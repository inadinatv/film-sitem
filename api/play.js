export default async function handler(req, res) {
  const { id, vid, lang, trackUrl } = req.query;

  // 1. OTOMATİK ALTYAZI ÇEVİRİCİ PROXY (SRT'yi VTT'ye Dönüştürür)
  if (trackUrl) {
      try {
          const trkRes = await fetch(trackUrl, {
              headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Referer": "https://www.filmmodu.one/" }
          });
          let trkTxt = await trkRes.text();
          
          // Eğer dosya SRT formatındaysa (virgül içeriyorsa), onu kusursuz VTT formatına (nokta) çeviririz!
          if (!trkTxt.includes('WEBVTT')) {
              trkTxt = "WEBVTT\n\n" + trkTxt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
          }
          
          res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
          res.setHeader('Access-Control-Allow-Origin', '*');
          return res.status(200).send(trkTxt);
      } catch(e) { return res.status(500).send(""); }
  }

  if (!id) return res.status(400).send("Film ID eksik.");

  try {
    const ua = "Mozilla/5.0 (Web0S; Linux/SmartTV)"; 
    const pageReq = await fetch(`https://www.filmmodu.one/${id}`, { headers: { "user-agent": ua, "referer": "https://www.filmmodu.one/" } });
    const html = await pageReq.text();
    const cookies = pageReq.headers.get('set-cookie'); 
    
    const vId = vid || (html.match(/videoId\s*=\s*'([^']+)'/) || html.match(/data-movie-id="([^"]+)"/) || [])[1];
    const csrf = (html.match(/"csrf-token" content="(.*?)"/) || [])[1];

    if (!vId || !csrf) return res.status(500).send("Video ID veya Token bulunamadı. Sayfayı yenileyin.");

    const targetLang = lang === 'en' ? 'en' : 'tr';
    const fallbackLang = targetLang === 'tr' ? 'en' : 'tr';
    const typesToTry = [targetLang, fallbackLang, '']; 
    
    let data = null;
    
    // Dil Seçici Motor
    for (let t of typesToTry) {
        let url = `https://www.filmmodu.one/get-source?movie_id=${vId}`;
        if (t) url += `&type=${t}`;
        
        const sourceReq = await fetch(url, {
          headers: { 
            "x-csrf-token": csrf, 
            "x-requested-with": "XMLHttpRequest", 
            "cookie": cookies || "", 
            "user-agent": ua, 
            "referer": `https://www.filmmodu.one/${id}` 
          }
        });
        
        try {
            const tempData = await sourceReq.json();
            if (tempData.sources && tempData.sources.length > 0) {
                data = tempData;
                break; 
            }
        } catch(e) { /* Sıradaki dile geçer */ }
    }

    if (!data || !data.sources || data.sources.length === 0) {
        return res.status(404).send("Sunucu kaynak vermedi.");
    }
    
    const videoUrl = data.sources[data.sources.length - 1].src;

    // Altyazı Linklerini Toplama
    let tracks = "";
    if (data.tracks) {
      data.tracks.forEach(t => {
        if (t.kind === 'captions' || t.kind === 'subtitles') {
          let trackFile = t.file || t.src;
          
          // LİNK DÜZELTİCİ (Bozuk veya eksik linkleri tamir eder)
          if (trackFile) {
              if (trackFile.startsWith('//')) {
                  trackFile = 'https:' + trackFile;
              } else if (!trackFile.startsWith('http')) {
                  trackFile = 'https://www.filmmodu.one' + trackFile;
              }
              
              const proxyUrl = `/api/play?trackUrl=${encodeURIComponent(trackFile)}`;
              tracks += `<track kind="captions" label="${t.label || 'Türkçe'}" src="${proxyUrl}" srclang="tr" default />\n`;
          }
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
            const opts = { captions: { active: true, language: 'tr', update: true }, seekTime: 10 };
            
            if (Hls.isSupported() && '${videoUrl}'.includes('m3u8')) {
                const hls = new Hls(); 
                hls.loadSource('${videoUrl}'); 
                hls.attachMedia(v);
                hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    window.player = new Plyr(v, opts);
                });
            } else { 
                v.src = '${videoUrl}'; 
                window.player = new Plyr(v, opts); 
            }
        </script>
    </body>
    </html>`);
  } catch (e) { res.status(500).send("Hata: " + e.message); }
}
