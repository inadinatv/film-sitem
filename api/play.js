export default async function handler(req, res) {
  const { id, vid, lang, trackUrl } = req.query;

  // ==========================================
  // 1. KUSURSUZ ALTYAZI ÇEVİRİCİ MOTOR (PROXY)
  // ==========================================
  if (trackUrl) {
      try {
          const fetchUrl = decodeURIComponent(trackUrl);
          const trkRes = await fetch(fetchUrl, {
              headers: {
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                  "Referer": "https://www.filmmodu.one/",
                  "Accept": "*/*"
              }
          });
          
          // Eğer dosya yoksa, player bozulmasın diye ekrana hata mesajı yazdırıyoruz
          if (!trkRes.ok) {
              res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
              return res.status(200).send("WEBVTT\n\n1\n00:00:00.000 --> 00:00:10.000\nAltyazı dosyası bulunamadı (404).");
          }

          let text = await trkRes.text();
          
          // Cloudflare engeline takılırsak HTML döner, bunu da ekrana yansıtıyoruz
          if (text.trim().toLowerCase().startsWith('<!doctype') || text.trim().toLowerCase().startsWith('<html')) {
              res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
              return res.status(200).send("WEBVTT\n\n1\n00:00:00.000 --> 00:00:10.000\nFilmmodu sunucusu altyazı indirmemizi geçici olarak engelledi.");
          }

          // SRT'yi VTT'ye hatasız çeviren işlem
          text = text.replace(/^\uFEFF/, ''); 
          text = text.replace(/\r\n/g, '\n'); 
          text = text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2'); 
          
          if (!text.includes('WEBVTT')) {
              text = "WEBVTT\n\n" + text;
          }

          res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
          res.setHeader('Access-Control-Allow-Origin', '*');
          return res.status(200).send(text);
      } catch(e) { 
          res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
          return res.status(200).send("WEBVTT\n\n1\n00:00:00.000 --> 00:00:10.000\nAltyazı motoru hatası: " + e.message);
      }
  }

  // ==========================================
  // 2. VİDEO VE DİL ÇEKME İŞLEMİ
  // ==========================================
  if (!id) return res.status(400).send("Film ID eksik.");

  try {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"; 
    const pageReq = await fetch(`https://www.filmmodu.one/${id}`, { headers: { "user-agent": ua, "referer": "https://www.filmmodu.one/" } });
    const html = await pageReq.text();
    const cookies = pageReq.headers.get('set-cookie') || ""; 
    
    const vId = vid || (html.match(/videoId\s*=\s*'([^']+)'/) || html.match(/data-movie-id="([^"]+)"/) || [])[1];
    const csrf = (html.match(/"csrf-token" content="(.*?)"/) || [])[1];

    if (!vId || !csrf) return res.status(500).send("Video ID bulunamadı.");

    const targetLang = lang === 'en' ? 'en' : 'tr';
    const fallbackLang = targetLang === 'tr' ? 'en' : 'tr';
    const typesToTry = [targetLang, fallbackLang, '']; 
    
    let data = null;
    
    for (let t of typesToTry) {
        let url = `https://www.filmmodu.one/get-source?movie_id=${vId}`;
        if (t) url += `&type=${t}`;
        const sourceReq = await fetch(url, {
          headers: { "x-csrf-token": csrf, "x-requested-with": "XMLHttpRequest", "cookie": cookies, "user-agent": ua, "referer": `https://www.filmmodu.one/${id}` }
        });
        try {
            const tempData = await sourceReq.json();
            if (tempData.sources && tempData.sources.length > 0) {
                data = tempData;
                break; 
            }
        } catch(e) {}
    }

    if (!data || !data.sources || data.sources.length === 0) return res.status(404).send("Sunucu kaynak vermedi.");
    const videoUrl = data.sources[data.sources.length - 1].src;

    // ==========================================
    // 3. TRACK (ALTYAZI) ETİKETLERİNİ OLUŞTURMA
    // ==========================================
    let tracksHtml = "";
    if (data.tracks && Array.isArray(data.tracks)) {
        data.tracks.forEach((t, index) => {
            let trackFile = t.file || t.src;
            if (trackFile && (t.kind === 'captions' || t.kind === 'subtitles' || trackFile.includes('.srt') || trackFile.includes('.vtt'))) {
                if (trackFile.startsWith('//')) trackFile = 'https:' + trackFile;
                else if (!trackFile.startsWith('http')) trackFile = 'https://www.filmmodu.one' + trackFile;
                
                // Yukarıda yazdığımız 1 numaralı proxy motoruna yönlendiriyoruz
                const proxyUrl = `/api/play?trackUrl=${encodeURIComponent(trackFile)}`;
                const isDefault = index === 0 ? "default" : "";
                
                tracksHtml += `<track kind="captions" label="${t.label || 'Türkçe'}" src="${proxyUrl}" srclang="tr" ${isDefault} />\n`;
            }
        });
    }

    // ==========================================
    // 4. HTML ÇIKTISI (PLAYER)
    // ==========================================
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
        <video id="player" playsinline controls crossorigin="anonymous">
            ${tracksHtml}
        </video>

        <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
        <script src="https://cdn.plyr.io/3.7.8/plyr.polyfilled.js"></script>
        <script>
            const video = document.getElementById('player');
            const source = '${videoUrl}';
            
            const opts = { 
                captions: { active: true, language: 'tr', update: true },
                seekTime: 10
            };

            if (Hls.isSupported() && source.includes('.m3u8')) {
                const hls = new Hls(); 
                hls.loadSource(source); 
                hls.attachMedia(video);
                hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    window.player = new Plyr(video, opts);
                });
            } else { 
                video.src = source; 
                window.player = new Plyr(video, opts); 
            }
        </script>
    </body>
    </html>`);
  } catch (e) { res.status(500).send("Hata: " + e.message); }
}
