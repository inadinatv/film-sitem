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

    let rawSubtitles = [];
    
    if (data.subtitle) {
        rawSubtitles.push({ label: 'Türkçe', file: data.subtitle });
    }
    if (data.tracks && Array.isArray(data.tracks)) {
        data.tracks.forEach(t => rawSubtitles.push({ label: t.label || 'Türkçe', file: t.file || t.src }));
    }

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
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <title>İnadına TV Player</title>
        <link rel="stylesheet" href="https://cdn.plyr.io/3.7.8/plyr.css" />
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            body, html { margin:0; padding:0; background:#000; overflow:hidden; width:100%; height:100vh; height:100dvh; } 
            
            .plyr { width: 100%; height: 100%; }
            
            video { width:100%; height:100%; object-fit: contain !important; transition: object-fit 0.3s; } 
            
            :root { --plyr-color-main: #e50914; }

            /* Ekran Modu Butonu CSS */
            #resizeBtn {
                position: absolute;
                top: 20px;
                left: 20px;
                z-index: 10000;
                background: rgba(229, 9, 20, 0.85);
                color: white;
                border: 1px solid rgba(255,255,255,0.3);
                border-radius: 8px;
                padding: 8px 15px;
                font-family: Arial, sans-serif;
                font-size: 13px;
                font-weight: bold;
                cursor: pointer;
                backdrop-filter: blur(5px);
                box-shadow: 0 4px 10px rgba(0,0,0,0.5);
                transition: 0.3s;
            }
            #resizeBtn:hover { background: #e50914; transform: scale(1.05); }

            /* Mobilde buton fazla yer kaplamasın */
            @media (max-width: 600px) {
                #resizeBtn { top: 15px; left: 15px; font-size: 11px; padding: 6px 10px; }
            }
        </style>
    </head>
    <body>
        <button id="resizeBtn" onclick="toggleFit()"><i class="fas fa-expand"></i> Ekran: Orijinal</button>
        <video id="player" playsinline controls crossorigin="anonymous"></video>

        <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
        <script src="https://cdn.plyr.io/3.7.8/plyr.polyfilled.js"></script>
        <script>
            // Ekran Modu Değiştirme Fonksiyonu
            const fitModes = ['contain', 'cover', 'fill'];
            const fitNames = ['Orijinal', 'Kırpıp Doldur', 'Esnet'];
            let currentFit = 0;

            function toggleFit() {
                const videoEl = document.querySelector('video');
                if(videoEl) {
                    currentFit = (currentFit + 1) % fitModes.length;
                    videoEl.style.setProperty('object-fit', fitModes[currentFit], 'important');
                    document.getElementById('resizeBtn').innerHTML = '<i class="fas fa-expand"></i> Ekran: ' + fitNames[currentFit];
                }
            }

            document.addEventListener('DOMContentLoaded', () => {
                const video = document.getElementById('player');
                const embeddedTracks = ${JSON.stringify(embeddedTracks)};

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

                let playerInstance;

                if (Hls.isSupported() && source.includes('.m3u8')) {
                    const hls = new Hls();
                    hls.loadSource(source);
                    hls.attachMedia(video);
                    hls.on(Hls.Events.MANIFEST_PARSED, () => {
                        playerInstance = new Plyr(video, opts);
                        setupCinemaMode(playerInstance);
                    });
                } else {
                    video.src = source;
                    playerInstance = new Plyr(video, opts);
                    setupCinemaMode(playerInstance);
                }

                function setupCinemaMode(plyrPlayer) {
                    let firstPlay = true;
                    
                    // 1. Oynatıldığında otomatik tam ekran yap
                    plyrPlayer.on('play', () => {
                        if (firstPlay && !plyrPlayer.fullscreen.active) {
                            plyrPlayer.fullscreen.enter().catch(err => console.log("Tam ekran hatası:", err));
                            firstPlay = false;
                        }
                    });

                    // 2. Tam ekrana girildiğinde zorla yatay yap
                    plyrPlayer.on('enterfullscreen', () => {
                        if (screen.orientation && screen.orientation.lock) {
                            screen.orientation.lock('landscape').catch(err => console.log("Yan ekran kilidi desteklenmiyor.", err));
                        }
                    });

                    // 3. Tam ekrandan çıkıldığında kilidi çöz ve normale dön
                    plyrPlayer.on('exitfullscreen', () => {
                        if (screen.orientation && screen.orientation.unlock) {
                            screen.orientation.unlock();
                        }
                    });
                }
            });
        </script>
    </body>
    </html>`);
  } catch (e) { res.status(500).send("Hata: " + e.message); }
}
