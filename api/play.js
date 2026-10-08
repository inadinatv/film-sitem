const SOURCE = 'https://www.filmmodu.one';

function cookieHeader(headers) {
  const values = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [headers.get('set-cookie') || ''];
  return values.map((value) => value.split(';', 1)[0].trim()).filter(Boolean).join('; ');
}

function mergeCookies(...values) {
  const cookies = new Map();
  values.filter(Boolean).join(';').split(';').forEach((part) => {
    const separator = part.indexOf('=');
    if (separator > 0) cookies.set(part.slice(0, separator).trim(), part.slice(separator + 1).trim());
  });
  return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
}

function normalizeSource(value) {
  if (!value) return '';
  let url = value.startsWith('//') ? `https:${value}` : value.startsWith('/') ? `${SOURCE}${value}` : value;
  try {
    const parsed = new URL(url);
    if ((parsed.hostname === 'imgsapi.pro' || parsed.hostname.endsWith('.imgsapi.pro')) && !/\.m3u8$/i.test(parsed.pathname)) parsed.pathname += '.m3u8';
    url = parsed.toString();
  } catch (_) {}
  return url;
}

function streamToken(url, cookie, referer) {
  return Buffer.from(JSON.stringify({ url, cookie: cookie || '', referer: referer || `${SOURCE}/` }), 'utf8').toString('base64url');
}

export default async function handler(req, res) {
  const { id, vid, lang } = req.query;

  if (!id) return res.status(400).send("Film ID eksik.");

  try {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"; 
    const pageReq = await fetch(`${SOURCE}/${id}`, { headers: { "user-agent": ua, "referer": `${SOURCE}/` } });
    const html = await pageReq.text();
    const cookies = cookieHeader(pageReq.headers);
    
    const vId = vid || (html.match(/videoId\s*(?:=|:)\s*['"]([^'"]+)['"]/i) || html.match(/data-(?:movie-id|video-id|id)=['"]([^'"]+)['"]/i) || [])[1];
    const csrf = (html.match(/<meta[^>]+name=['"]csrf-token['"][^>]+content=['"]([^'"]*)['"]/i) || html.match(/csrfToken\s*[:=]\s*['"]([^'"]+)['"]/i) || [])[1] || "";

    if (!vId) return res.status(404).send("Bu film için oynatıcı kaynağı bulunamadı.");

    const targetLang = lang === 'en' ? 'en' : 'tr';
    const typesToTry = [targetLang, targetLang === 'tr' ? 'en' : 'tr', '']; 
    
    let data = null;
    
    for (let t of typesToTry) {
        let url = `${SOURCE}/get-source?movie_id=${encodeURIComponent(vId)}`;
        if (t) url += `&type=${t}`;
        const sourceReq = await fetch(url, {
          headers: { ...(csrf ? { "x-csrf-token": csrf } : {}), "accept": "application/json, text/plain, */*", "x-requested-with": "XMLHttpRequest", ...(cookies ? { "cookie": cookies } : {}), "user-agent": ua, "referer": `${SOURCE}/${id}` }
        });
        const sourceCookies = cookieHeader(sourceReq.headers);
        try {
            const tempData = await sourceReq.json();
            const sources = tempData.sources || tempData.data?.sources || (Array.isArray(tempData.data) ? tempData.data : []);
            if (sources.length > 0) {
                data = { ...tempData, sources, __cookie: mergeCookies(cookies, sourceCookies) };
                break; 
            }
        } catch(e) {}
    }

    if (!data || !data.sources || data.sources.length === 0) return res.status(404).send("Sunucu kaynak vermedi.");
    const usableSources = data.sources.filter(s => s && (s.src || s.file || s.url));
    if (!usableSources.length) return res.status(404).send("Sunucu geçerli video kaynağı vermedi.");
    const streamCookie = mergeCookies(cookies, data.__cookie);
    const sourceReferer = `${SOURCE}/${id}`;
    const playbackSources = [];
    const seenSources = new Set();
    for (const candidate of [...usableSources].reverse()) {
        const videoUrl = normalizeSource(candidate.src || candidate.file || candidate.url);
        const sourceType = `${candidate.type || ''} ${candidate.mimeType || ''}`;
        const isHls = /\.m3u8(?:$|\?)/i.test(videoUrl) || /(?:hls|mpegurl|m3u8)/i.test(sourceType);
        const isVideo = isHls || /\.(?:mp4|m4v|webm|ogv|mpd)(?:$|\?)/i.test(videoUrl) || /(?:video\/(?:mp4|webm|ogg|mp2t)|dash|\bmp4\b|\bwebm\b)/i.test(sourceType);
        if (!isVideo || seenSources.has(videoUrl)) continue;
        seenSources.add(videoUrl);
        playbackSources.push({
            url: `/api/stream?token=${encodeURIComponent(streamToken(videoUrl, streamCookie, sourceReferer))}`,
            isHls,
        });
    }
    if (!playbackSources.length) {
        const selectedSource = usableSources[usableSources.length - 1];
        const videoUrl = normalizeSource(selectedSource.src || selectedSource.file || selectedSource.url);
        const isHls = /\.m3u8(?:$|\?)/i.test(videoUrl) || /(?:hls|mpegurl|m3u8)/i.test(`${selectedSource.type || ''} ${selectedSource.mimeType || ''}`);
        playbackSources.push({ url: `/api/stream?token=${encodeURIComponent(streamToken(videoUrl, streamCookie, sourceReferer))}`, isHls });
    }
    const streamUrl = playbackSources[0].url;
    const isHls = playbackSources[0].isHls;

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
                const subRes = await fetch(trackFile, { headers: { ...(mergeCookies(cookies, data.__cookie) ? { "cookie": mergeCookies(cookies, data.__cookie) } : {}), "user-agent": ua } });
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
                transition: opacity 0.4s ease, transform 0.3s;
                opacity: 1;
            }
            
            #resizeBtn:hover { background: #e50914; transform: scale(1.05); }

            /* Oynatıcı kontrolleri kaybolunca buton da kaybolsun */
            .plyr--hide-controls #resizeBtn {
                opacity: 0 !important;
                pointer-events: none !important;
            }
            
            /* Tıkladıktan sonra zorla gizlemek için sınıf */
            .force-hide {
                opacity: 0 !important;
                pointer-events: none !important;
            }

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
            const fitModes = ['contain', 'cover', 'fill'];
            const fitNames = ['Orijinal', 'Kırpıp Doldur', 'Esnet'];
            let currentFit = 0;
            let hideTimeout;

            // Ekran Modu Değiştirme Fonksiyonu
            function toggleFit() {
                const videoEl = document.querySelector('video');
                const btn = document.getElementById('resizeBtn');
                
                if(videoEl && btn) {
                    currentFit = (currentFit + 1) % fitModes.length;
                    videoEl.style.setProperty('object-fit', fitModes[currentFit], 'important');
                    btn.innerHTML = '<i class="fas fa-expand"></i> Ekran: ' + fitNames[currentFit];
                    
                    // İşlem yapıldıktan 1.5 saniye sonra kendiliğinden kaybolması için
                    clearTimeout(hideTimeout);
                    hideTimeout = setTimeout(() => {
                        btn.classList.add('force-hide');
                    }, 1500);
                }
            }

            // Ekrana tıklandığında (veya dokunulduğunda) butonu geri getir
            document.addEventListener('click', (e) => {
                const btn = document.getElementById('resizeBtn');
                if(btn && e.target.id !== 'resizeBtn') {
                    btn.classList.remove('force-hide');
                }
            });

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

                const source = ${JSON.stringify(streamUrl)};
                const isHls = ${JSON.stringify(isHls)};
                const playbackSources = ${JSON.stringify(playbackSources)};
                const opts = {
                    captions: { active: true, language: 'tr', update: true },
                    seekTime: 10
                };

                let playerInstance;
                let activeHls;
                let activeSourceIndex = -1;
                let fallbackPending = false;
                let activeHlsManaged = false;
                let failureShown = false;

                function initializePlayer() {
                    if (playerInstance) return;
                    playerInstance = new Plyr(video, opts);
                    setupCinemaMode(playerInstance);
                }

                function tryNextSource(failedIndex) {
                    if (failedIndex !== activeSourceIndex || fallbackPending) return;
                    if (failedIndex + 1 >= playbackSources.length) {
                        if (!failureShown) {
                            failureShown = true;
                            const notice = document.createElement('div');
                            notice.textContent = 'Bu film şu anda yayın sağlayıcısından alınamıyor. Lütfen daha sonra tekrar deneyin.';
                            notice.style.cssText = 'position:fixed;z-index:20000;left:50%;top:50%;transform:translate(-50%,-50%);max-width:85%;padding:16px 20px;border-radius:8px;background:rgba(20,20,20,.94);color:#fff;font:16px Arial,sans-serif;text-align:center;';
                            document.body.appendChild(notice);
                        }
                        return;
                    }
                    fallbackPending = true;
                    setTimeout(() => {
                        if (activeSourceIndex === failedIndex) loadSource(failedIndex + 1);
                    }, 250);
                }

                function loadSource(index) {
                    if (index >= playbackSources.length) return;
                    activeSourceIndex = index;
                    fallbackPending = false;
                    activeHlsManaged = false;
                    if (activeHls) {
                        activeHls.destroy();
                        activeHls = null;
                    }
                    video.pause();
                    video.removeAttribute('src');
                    video.load();

                    const candidate = playbackSources[index];
                    if (candidate.isHls && typeof Hls !== 'undefined' && Hls.isSupported()) {
                        activeHlsManaged = true;
                        const hls = new Hls();
                        activeHls = hls;
                        let sourceErrors = 0;
                        hls.on(Hls.Events.ERROR, (_event, data) => {
                            if (index !== activeSourceIndex) return;
                            sourceErrors += 1;
                            if (data.fatal || sourceErrors >= 3) tryNextSource(index);
                        });
                        hls.on(Hls.Events.MANIFEST_PARSED, () => {
                            if (index === activeSourceIndex) initializePlayer();
                        });
                        hls.loadSource(candidate.url);
                        hls.attachMedia(video);
                    } else {
                        video.src = candidate.url;
                        video.load();
                        initializePlayer();
                    }
                }

                video.addEventListener('error', () => {
                    if (!activeHlsManaged) tryNextSource(activeSourceIndex);
                });
                loadSource(0);

                function setupCinemaMode(plyrPlayer) {
                    // YENİ: Butonu Plyr oynatıcısının içine taşı ki tam ekranda da kaybolmasın
                    const plyrContainer = document.querySelector('.plyr');
                    const resizeBtn = document.getElementById('resizeBtn');
                    if (plyrContainer && resizeBtn) {
                        plyrContainer.appendChild(resizeBtn);
                    }

                    let firstPlay = true;
                    
                    plyrPlayer.on('play', () => {
                        if (firstPlay && !plyrPlayer.fullscreen.active) {
                            plyrPlayer.fullscreen.enter().catch(err => console.log("Tam ekran hatası:", err));
                            firstPlay = false;
                        }
                    });

                    plyrPlayer.on('enterfullscreen', () => {
                        if (screen.orientation && screen.orientation.lock) {
                            screen.orientation.lock('landscape').catch(err => console.log("Yan ekran kilidi desteklenmiyor.", err));
                        }
                    });

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
