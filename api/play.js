export default async function handler(req, res) {
  const { id, vid, lang } = req.query;

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
        return res.status(404).send("Sunucu kaynak vermedi. Site koruması engellemiş olabilir.");
    }
    
    const videoUrl = data.sources[data.sources.length - 1].src;

    // YENİ SİSTEM: ALTYAZIYI DOĞRUDAN HTML İÇİNE GÖMME (BASE64)
    let tracks = "";
    if (data.tracks) {
      const trackPromises = data.tracks.map(async (t) => {
        if (t.kind === 'captions' || t.kind === 'subtitles') {
          let trackFile = t.file || t.src;
          if (trackFile) {
              if (trackFile.startsWith('//')) trackFile = 'https:' + trackFile;
              else if (!trackFile.startsWith('http')) trackFile = 'https://www.filmmodu.one' + trackFile;
              
              try {
                  // Altyazıyı o an sunucudan indiriyoruz
                  const trkRes = await fetch(trackFile, {
                      headers: { "User-Agent": ua, "Referer": "https://www.filmmodu.one/", "Cookie": cookies || "" }
                  });
                  let trkTxt = await trkRes.text();
                  
                  // Hatalı virgülleri noktaya çevirip düzeltiyoruz
                  trkTxt = trkTxt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
                  
                  // Dosyayı VTT formatına zorluyoruz
                  if (!trkTxt.includes('WEBVTT')) {
                      trkTxt = "WEBVTT\n\n" + trkTxt;
                  }

                  // Metni Base64 şifrelemesine çevirerek doğrudan koda gömüyoruz (Engellenemez)
                  const base64Vtt = Buffer.from(trkTxt).toString('base64');
                  const dataUrl = `data:text/vtt;base64,${base64Vtt}`;

                  return `<track kind="captions" label="${t.label || 'Türkçe'}" src="${dataUrl}" srclang="tr" default />\n`;
              } catch(e) {
                  return ""; 
              }
          }
        }
        return "";
      });
      
      const trackResults = await Promise.all(trackPromises);
      tracks = trackResults.join("");
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
