export default async function handler(req, res) {
  const { id, vid } = req.query;
  if (!id) return res.status(400).send("Film ID eksik.");

  try {
    const pageReq = await fetch(`https://www.filmmodu.one/${id}`, {
      headers: { "user-agent": "Mozilla/5.0", "referer": "https://www.filmmodu.one/" }
    });
    const html = await pageReq.text();
    
    const videoId = vid || (html.match(/videoId\s*=\s*'([^']+)'/) || html.match(/data-movie-id="([^"]+)"/) || [])[1];
    const csrfToken = (html.match(/"csrf-token" content="(.*?)"/) || [])[1];

    if (!videoId || !csrfToken) return res.status(500).send("Video engeli veya dil ID'si bulunamadı.");

    const sourceReq = await fetch(`https://www.filmmodu.one/get-source?movie_id=${videoId}&type=en`, {
      headers: { "x-csrf-token": csrfToken, "x-requested-with": "XMLHttpRequest", "referer": `https://www.filmmodu.one/${id}` }
    });

    const data = await sourceReq.json();
    if (!data.sources || data.sources.length === 0) return res.status(404).send("Link bulunamadı.");
    const videoUrl = data.sources[data.sources.length - 1].src;

    // ALTYAZI (SUBTITLE) YAKALAMA SİSTEMİ
    let tracksHtml = "";
    if (data.tracks && Array.isArray(data.tracks)) {
        data.tracks.forEach(track => {
            // Sadece captions (altyazı) türündeki dosyaları alıyoruz
            if (track.kind === 'captions' || track.kind === 'subtitles') {
                // Eğer altyazı dili belirtilmemişse varsayılan olarak Türkçe (tr) etiketliyoruz
                let label = track.label ? track.label : 'Türkçe';
                tracksHtml += `<track kind="captions" label="${label}" src="${track.file}" srclang="tr" default />\n`;
            }
        });
    }

    const playerHtml = `
    <!DOCTYPE html>
    <html lang="tr">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>İnadına TV Player</title>
        <link rel="stylesheet" href="https://cdn.plyr.io/3.7.8/plyr.css" />
        <style>
            body { margin: 0; background: #000; overflow: hidden; }
            .container { width: 100vw; height: 100vh; display: flex; align-items: center; justify-content: center; }
            video { width: 100%; height: 100%; }
            :root { --plyr-color-main: #e50914; }
        </style>
    </head>
    <body>
        <div class="container">
            <video id="player" playsinline controls crossorigin>
                ${tracksHtml}
            </video>
        </div>
        
        <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
        <script src="https://cdn.plyr.io/3.7.8/plyr.polyfilled.js"></script>
        <script>
            const video = document.getElementById('player');
            const source = '${videoUrl}';
            
            const defaultOptions = {
                controls: ['play-large', 'play', 'progress', 'current-time', 'duration', 'mute', 'volume', 'captions', 'settings', 'pip', 'airplay', 'fullscreen'],
                seekTime: 10,
                captions: { active: true, update: true, language: 'tr' } // Altyazıyı otomatik aç
            };

            if (Hls.isSupported() && source.includes('.m3u8')) {
                const hls = new Hls();
                hls.loadSource(source);
                hls.attachMedia(video);
                hls.on(Hls.Events.MANIFEST_PARSED, () => { window.player = new Plyr(video, defaultOptions); });
            } else {
                video.src = source;
                window.player = new Plyr(video, defaultOptions);
            }
        </script>
    </body>
    </html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(playerHtml);

  } catch (err) {
    res.status(500).send("Sistem Hatası: " + err.message);
  }
}
