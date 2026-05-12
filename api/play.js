export default async function handler(req, res) {
  const { id, vid, lang } = req.query;

  if (!id) return res.status(400).send("Film ID eksik.");

  try {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"; 
    const pageReq = await fetch(`https://www.filmmodu.one/${id}`, { headers: { "user-agent": ua, "referer": "https://www.filmmodu.one/" } });
    const html = await pageReq.text();
    const cookies = pageReq.headers.get('set-cookie'); 
    
    const vId = vid || (html.match(/videoId\s*=\s*'([^']+)'/) || html.match(/data-movie-id="([^"]+)"/) || [])[1];
    const csrf = (html.match(/"csrf-token" content="(.*?)"/) || [])[1];

    if (!vId || !csrf) return res.status(500).send("Video ID bulunamadı. Sayfayı yenileyin.");

    const targetLang = lang === 'en' ? 'en' : 'tr';
    const fallbackLang = targetLang === 'tr' ? 'en' : 'tr';
    const typesToTry = [targetLang, fallbackLang, '']; 
    
    let data = null;
    
    for (let t of typesToTry) {
        let url = `https://www.filmmodu.one/get-source?movie_id=${vId}`;
        if (t) url += `&type=${t}`;
        const sourceReq = await fetch(url, {
          headers: { "x-csrf-token": csrf, "x-requested-with": "XMLHttpRequest", "cookie": cookies || "", "user-agent": ua, "referer": `https://www.filmmodu.one/${id}` }
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

    // Altyazı linklerini topla (Ama indirme işlemini izleyicinin tarayıcısına bırak)
    let subtitleUrls = [];
    if (data.tracks) {
        data.tracks.forEach(t => {
            if (t.file && (t.kind === 'captions' || t.kind === 'subtitles' || t.kind === 'subtitle' || t.file.includes('.srt') || t.file.includes('.vtt'))) {
                let trackFile = t.file;
                if (trackFile.startsWith('//')) trackFile = 'https:' + trackFile;
                else if (!trackFile.startsWith('http')) trackFile = 'https://www.filmmodu.one' + trackFile;
                subtitleUrls.push({ label: t.label || 'Türkçe', url: trackFile });
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
        <video id="player" playsinline controls crossorigin="anonymous"></video>

        <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
        <script src="https://cdn.plyr.io/3.7.8/plyr.polyfilled.js"></script>
        <script>
            const video = document.getElementById('player');
            const subs = ${JSON.stringify(subtitleUrls)};
            
            // 1. İstemci Tarafı (Senin Tarayıcın) Altyazı İndirici
            async function fetchSubtitle(url) {
                // Cloudflare engelini aşmak için gizli geçitler kullanır
                const proxies = [
                    url, 
                    'https://api.allorigins.win/raw?url=' + encodeURIComponent(url),
                    'https://corsproxy.io/?' + encodeURIComponent(url)
                ];
                
                for (let proxy of proxies) {
                    try {
                        const res = await fetch(proxy);
                        const text = await res.text();
                        // Sahte Cloudflare sayfası yerine gerçek altyazı (-->) geldiğinden emin olur
                        if (text.includes('-->') || text.includes('WEBVTT')) {
                            return text;
                        }
                    } catch(e) {}
                }
                return null;
            }

            // 2. Sistemi Başlatıcı
            async function initPlayer() {
                let hasAddedTrack = false;

                for (let i = 0; i < subs.length; i++) {
                    let text = await fetchSubtitle(subs[i].url);
                    
                    if (text) {
                        // Bozuk SRT formatını sorunsuz VTT'ye (noktalı) çevir
                        text = text.replace(/([0-9]{2}:[0-9]{2}:[0-9]{2}),([0-9]{3})/g, '$1.$2');
                        if (!text.includes('WEBVTT')) {
                            text = "WEBVTT\\n\\n" + text;
                        }

                        // Sanal dosya oluşturup Player'a zorla enjekte et
                        const blob = new Blob([text], { type: 'text/vtt' });
                        const blobUrl = URL.createObjectURL(blob);
                        
                        const track = document.createElement('track');
                        track.kind = 'captions';
                        track.label = subs[i].label;
                        track.srclang = 'tr';
                        track.src = blobUrl;
                        if (!hasAddedTrack) {
                            track.default = true;
                            hasAddedTrack = true;
                        }
                        
                        video.appendChild(track);
                    }
                }

                const source = '${videoUrl}';
                // CC butonunun her şartta görünmesini ZORUNLU KILAR
                const opts = { 
                    captions: { active: true, language: 'tr', update: true }, 
                    controls: ['play-large', 'play', 'progress', 'current-time', 'duration', 'mute', 'volume', 'captions', 'settings', 'pip', 'airplay', 'fullscreen'],
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
            }

            initPlayer();
        </script>
    </body>
    </html>`);
  } catch (e) { res.status(500).send("Hata: " + e.message); }
}
