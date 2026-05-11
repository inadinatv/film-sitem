export default async function handler(req, res) {
  const { id, vid } = req.query;
  try {
    const pageReq = await fetch(`https://www.filmmodu.one/${id}`, { headers: { "user-agent": "Mozilla/5.0", "referer": "https://www.filmmodu.one/" } });
    const html = await pageReq.text();
    const vId = vid || (html.match(/videoId\s*=\s*'([^']+)'/) || html.match(/data-movie-id="([^"]+)"/) || [])[1];
    const csrf = (html.match(/"csrf-token" content="(.*?)"/) || [])[1];

    const sourceReq = await fetch(`https://www.filmmodu.one/get-source?movie_id=${vId}&type=en`, {
      headers: { "x-csrf-token": csrf, "x-requested-with": "XMLHttpRequest", "referer": `https://www.filmmodu.one/${id}` }
    });
    const data = await sourceReq.json();
    const videoUrl = data.sources[data.sources.length - 1].src;

    let tracks = "";
    if (data.tracks) {
        data.tracks.forEach(t => {
            if (t.kind === 'captions' || t.kind === 'subtitles') {
                tracks += `<track kind="captions" label="${t.label || 'Türkçe'}" src="${t.file}" srclang="tr" default />`;
            }
        });
    }

    res.setHeader('Content-Type', 'text/html');
    res.send(`
    <html>
    <head>
        <link rel="stylesheet" href="https://cdn.plyr.io/3.7.8/plyr.css" />
        <style>body { margin:0; background:#000; } :root { --plyr-color-main: #e50914; }</style>
    </head>
    <body>
        <video id="player" playsinline controls crossorigin>${tracks}</video>
        <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
        <script src="https://cdn.plyr.io/3.7.8/plyr.polyfilled.js"></script>
        <script>
            const v = document.querySelector('video');
            const src = '${videoUrl}';
            const opts = { captions: { active: true, language: 'tr' }, seekTime: 10 };
            if (Hls.isSupported() && src.includes('m3u8')) {
                const hls = new Hls(); hls.loadSource(src); hls.attachMedia(v);
                hls.on(Hls.Events.MANIFEST_PARSED, () => new Plyr(v, opts));
            } else { v.src = src; new Plyr(v, opts); }
        </script>
    </body>
    </html>`);
  } catch (e) { res.status(500).send(e.message); }
}
