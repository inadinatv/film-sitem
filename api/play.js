export default async function handler(req, res) {
  const { id, vid, lang } = req.query;

  if (!id) return res.status(400).send("Film ID eksik.");

  try {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"; 
    const pageReq = await fetch(`https://www.filmmodu.one/${id}`, { headers: { "user-agent": ua, "referer": "https://www.filmmodu.one/" } });
    const html = await pageReq.text();
    const cookies = pageReq.headers.get('set-cookie') || ""; 
    
    const vId = vid || (html.match(/videoId\s*=\s*'([^']+)'/) || html.match(/data-movie-id="([^"]+)"/) || [])[1];
    const csrf = (html.match(/"csrf-token" content="(.*?)"/) || [])[1];

    if (!vId || !csrf) return res.status(500).send("Video ID bulunamadı. Sayfayı yenileyin.");

    const targetLang = lang === 'en' ? 'en' : 'tr';
    const typesToTry = [targetLang, targetLang === 'tr' ? 'en' : 'tr', '']; 
    
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

    // === BÜYÜK KEŞİF BURADA DEVREYE GİRİYOR ===
    let rawSubtitles = [];
    
    // 1. Ekran görüntüsünde yakaladığımız yeni gizli alan
    if (data.subtitle) {
        rawSubtitles.push({ label: 'Türkçe', file: data.subtitle });
    }
    // 2. Eski sistem olanlar için yedek arama
    if (data.tracks && Array.isArray(data.tracks)) {
        data.tracks.forEach(t => rawSubtitles.push({ label: t.label || 'Türkçe', file: t.file || t.src }));
    }

    // Altyazıları güvenli bir şekilde sunucuda indirip gömüyoruz
    let embeddedTracks = [];
    for (let t of rawSubtitles) {
        let trackFile = t.file;
        if (trackFile) {
            if (trackFile.startsWith('//')) trackFile = 'https:' + trackFile;
            else if (!trackFile.startsWith('http')) trackFile = 'https://www.filmmodu.one' + trackFile;

            try {
                const subRes = await fetch(trackFile, { headers: { "cookie": cookies, "user-agent": ua } });
                if (subRes.ok) {
                    let text = await subRes.text();
                    text = text.replace(/^\uFEFF/, '');
                    text = text.replace(/\r\n/g, '\n');
                    text = text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
                    if (!text.includes('WEBVTT')) text = "WEBVTT\n\n" + text;

                    embeddedTracks.push({
                        label: t.label,
                        data: encodeURIComponent(text)
                    });
                }
            } catch (err) {}
        }
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
        <video id="player" playsinline controls crossorigin="anonymous"></video>

        <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
        <script src="https://cdn.plyr.io/3.7.8/plyr.polyfilled.js"></script>
        <script>
            document.addEventListener('DOMContentLoaded', () => {
                const video = document.getElementById('player');
                const embeddedTracks = ${JSON.stringify(embeddedTracks)};

                // Bulunan tüm altyazıları player'a işliyoruz
                embeddedTracks.forEach((trackInfo, index) => {
                    const blob = new Blob([decodeURIComponent(trackInfo.data)], { type: 'text/vtt' });
                    const url = URL.createObjectURL(blob);

                    const track = document.createElement('track');
                    track.kind = 'captions';
                    track.label = trackInfo.label;
                    track.srclang = 'tr';
                    track.src = url;
                    if (index === 0) track.default = true;

                    video.appendChild(track);
                });

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
            });
        </script>
    </body>
    </html>`);
  } catch (e) { res.status(500).send("Hata: " + e.message); }
}
