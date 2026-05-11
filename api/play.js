export default async function handler(req, res) {
  const { id } = req.query;
  try {
    const pageReq = await fetch(`https://www.filmmodu.one/${id}`, { headers: { "user-agent": "Mozilla/5.0", "referer": "https://www.filmmodu.one/" } });
    const html = await pageReq.text();
    const videoId = (html.match(/videoId\s*=\s*'([^']+)'/) || [])[1];
    const csrfToken = (html.match(/"csrf-token" content="(.*?)"/) || [])[1];

    const sourceReq = await fetch(`https://www.filmmodu.one/get-source?movie_id=${videoId}&type=en`, {
      headers: { "x-csrf-token": csrfToken, "x-requested-with": "XMLHttpRequest", "referer": `https://www.filmmodu.one/${id}` }
    });
    const data = await sourceReq.json();
    const videoUrl = data.sources[data.sources.length - 1].src;

    const playerHtml = `
    <html>
    <head>
        <link rel="stylesheet" href="https://cdn.plyr.io/3.7.8/plyr.css" />
        <style>
            body { margin: 0; background: #000; }
            .container { width: 100%; height: 100vh; display: flex; align-items: center; }
        </style>
    </head>
    <body>
        <div class="container">
            <video id="player" playsinline controls data-poster="">
                <source src="${videoUrl}" type="video/mp4" />
            </video>
        </div>
        <script src="https://cdn.plyr.io/3.7.8/plyr.polyfilled.js"></script>
        <script>
            const player = new Plyr('#player', {
                controls: ['play-large', 'play', 'progress', 'current-time', 'mute', 'volume', 'captions', 'settings', 'pip', 'airplay', 'fullscreen'],
                seekTime: 10 // İleri-geri 10 saniye sarar
            });
        </script>
    </body>
    </html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(playerHtml);
  } catch (e) { res.status(500).send("Hata: " + e.message); }
}
