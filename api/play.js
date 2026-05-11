export default async function handler(req, res) {
  const { id } = req.query;
  if (!id) return res.status(400).send("Film ID eksik.");

  try {
    const pageReq = await fetch(`https://www.filmmodu.one/${id}`, {
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0)", "referer": "https://www.filmmodu.one/" }
    });
    const html = await pageReq.text();

    // Regexleri daha esnek hale getirdik (Bazı filmlerdeki engelleri aşmak için)
    const videoMatch = html.match(/videoId\s*=\s*'([^']+)'/) || html.match(/data-movie-id="([^"]+)"/);
    const videoId = videoMatch ? videoMatch[1] : null;

    const tokenMatch = html.match(/"csrf-token" content="(.*?)"/);
    const csrfToken = tokenMatch ? tokenMatch[1] : null;

    if (!videoId || !csrfToken) {
        return res.status(500).send("Video ID bulunamadı. Bu film Filmmodu üzerinde silinmiş veya özel korumalı olabilir.");
    }

    const sourceReq = await fetch(`https://www.filmmodu.one/get-source?movie_id=${videoId}&type=en`, {
      headers: { "x-csrf-token": csrfToken, "x-requested-with": "XMLHttpRequest", "referer": `https://www.filmmodu.one/${id}` }
    });

    const data = await sourceReq.json();
    const lastQuality = data.sources[data.sources.length - 1];

    if (!lastQuality || !lastQuality.src) return res.status(404).send("Videonun oynatma linki bulunamadı.");

    const videoUrl = lastQuality.src;

    // Yönlendirme (Redirect) yerine kendi özel Player'ımızı ekrana çiziyoruz
    const playerHtml = `
    <!DOCTYPE html>
    <html lang="tr">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>İnadına TV Player</title>
        <style>
            body { margin: 0; background-color: #000; display: flex; justify-content: center; align-items: center; height: 100vh; overflow: hidden; }
            video { width: 100%; height: 100%; max-width: 1200px; outline: none; }
            .loading { position: absolute; color: white; font-family: sans-serif; }
        </style>
    </head>
    <body>
        <div class="loading" id="loadingText">Video yükleniyor, lütfen bekleyin...</div>
        <video id="player" controls autoplay playsinline crossorigin="anonymous">
            <source src="${videoUrl}" type="application/x-mpegURL">
            <source src="${videoUrl}" type="video/mp4">
        </video>
        
        <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
        <script>
            var video = document.getElementById('player');
            var videoSrc = '${videoUrl}';
            
            video.onplaying = function() {
                document.getElementById('loadingText').style.display = 'none';
            };

            if (Hls.isSupported() && videoSrc.includes('.m3u8')) {
                var hls = new Hls();
                hls.loadSource(videoSrc);
                hls.attachMedia(video);
                hls.on(Hls.Events.MANIFEST_PARSED, function() {
                    video.play();
                });
            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                video.src = videoSrc;
                video.addEventListener('loadedmetadata', function() {
                    video.play();
                });
            }
        </script>
    </body>
    </html>
    `;

    // Tarayıcıya HTML kodunu gönder
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(playerHtml);

  } catch (err) {
    res.status(500).send("Sistem Hatası: " + err.message);
  }
}
