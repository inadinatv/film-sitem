const SOURCE = 'https://filmmodu.one';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36';

function cors(headers = {}) {
  return {
    ...headers,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Range, If-Range',
    'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range, Content-Type, ETag, Last-Modified',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: cors({ 'Content-Type': 'application/json; charset=utf-8' }),
  });
}

function decode(s = '') {
  return s
    .replace(/&#0*(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x0*([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').trim();
}

function movieUrl(id) {
  if (!id || /[\s"'<>\\/]/.test(id)) return null;
  return `${SOURCE}/${id}`;
}

function apiUrl(path, params = {}) {
  const url = new URL(path, 'https://worker.invalid');
  Object.entries(params).forEach(([key, value]) => value != null && url.searchParams.set(key, value));
  return `${url.pathname}${url.search}`;
}

async function sourcePage(id) {
  const url = movieUrl(id);
  if (!url) throw new Error('Geçersiz film ID.');
  const response = await fetch(url, {
    headers: {
      'user-agent': UA,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      referer: `${SOURCE}/`,
    },
  });
  const html = await response.text();
  return { response, html, cookie: cookieHeader(response.headers) };
}

function cookieHeader(headers) {
  const values = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : [headers.get('set-cookie') || ''];
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

function csrfToken(html) {
  return (html.match(/<meta[^>]+name=['"]csrf-token['"][^>]+content=['"]([^'"]*)['"]/i)
    || html.match(/csrfToken\s*[:=]\s*['"]([^'"]+)['"]/i) || [])[1] || '';
}

function isNotFound(html, status) {
  return status === 404 || status >= 500 || /Sayfa Bulunamadı|BULUNAMADI!/i.test(html) || /<title>[^<]*Sayfa Bulunamadı[^<]*<\/title>/i.test(html);
}

function parseInfo(id, html) {
  const descMatch = html.match(/<meta[^>]+property=['"]og:description['"][^>]+content=['"]([^'"]*)['"]/i)
    || html.match(/<meta[^>]+content=['"]([^'"]*)['"][^>]+property=['"]og:description['"]/i);
  const desc = descMatch ? decode(descMatch[1]) : 'Film açıklaması yüklenemedi.';
  const languages = [];
  const seen = new Set();
  const add = (name, url) => {
    const clean = decode(name).replace(/\s+/g, ' ').trim();
    if (!clean || seen.has(clean.toLowerCase())) return;
    seen.add(clean.toLowerCase());
    languages.push({ name: clean, url });
  };
  const isSlug = (s) => s && /^[^\s"'<>\\]+-film-izle$/.test(s);
  const links = /<a[^>]+href=['"]([^'"]+)['"][^>]*>(.*?)<\/a>/gi;
  let match;
  while ((match = links.exec(html))) {
    const text = match[2].replace(/<[^>]+>/g, '').trim();
    const lower = text.toLowerCase();
    if (lower.includes('filmler') || lower.includes('fragman')) continue;
    if ((lower.includes('dublaj') || lower.includes('altyaz')) && text.length < 35) {
      const slug = match[1].split('/').filter(Boolean).pop();
      if (isSlug(slug)) {
        const lang = lower.includes('altyaz') ? 'en' : 'tr';
        add(lower.includes('altyaz') ? 'Türkçe Altyazılı' : 'Türkçe Dublaj', apiUrl('/api/play', { id: slug, lang }));
      }
    }
  }
  const hasPlayer = /videoId\s*(?:=|:)\s*['"][^'"]+['"]|data-(?:movie-id|video-id|id)=['"][^'"]+['"]|\/get-source/i.test(html);
  if (!languages.length && hasPlayer) {
    const title = (html.match(/<title>([^<]+)<\/title>/i) || ['', ''])[1].toLowerCase();
    const lang = title.includes('altyaz') || id.includes('-altyazili-') ? 'en' : 'tr';
    add(lang === 'en' ? 'Türkçe Altyazılı' : 'Türkçe Dublaj', apiUrl('/api/play', { id, lang }));
  }
  return { exists: languages.length > 0 || hasPlayer, desc, languages };
}

async function info(id, vid) {
  const { response, html, cookie: pageCookie } = await sourcePage(id);
  if (isNotFound(html, response.status)) return json({ exists: false, error: 'Film bulunamadı.' }, 404);
  const parsed = parseInfo(id, html);
  if (parsed.exists || !vid) return json(parsed);

  for (const lang of ['tr', 'en']) {
    try {
      const candidate = await fetchSourceCandidate(vid, lang, `${SOURCE}/${id}`, { cookie: pageCookie, csrf: csrfToken(html) });
      if (candidate?.sources?.some((source) => source && (source.src || source.file || source.url))) {
        return json({
          exists: true,
          desc: parsed.desc,
          languages: [{
            name: lang === 'en' ? 'Türkçe Altyazılı' : 'Türkçe Dublaj',
            url: apiUrl('/api/play', { id, lang, vid }),
          }],
        });
      }
    } catch (_) {}
  }
  return json(parsed);
}

function absoluteUrl(value) {
  if (!value) return '';
  let url = value.startsWith('//') ? `https:${value}` : value.startsWith('/') ? `${SOURCE}${value}` : value;
  try {
    const parsed = new URL(url);
    if ((parsed.hostname === 'imgsapi.pro' || parsed.hostname.endsWith('.imgsapi.pro')) && !/\.m3u8$/i.test(parsed.pathname)) {
      parsed.pathname += '.m3u8';
    }
    url = parsed.toString();
  } catch (_) {}
  return url;
}

async function fetchSourceCandidate(vid, type, referer, session = {}) {
  const query = `movie_id=${encodeURIComponent(vid)}&type=${encodeURIComponent(type)}`;
  const headers = {
    accept: 'application/json, text/plain, */*',
    'x-requested-with': 'XMLHttpRequest',
    'user-agent': UA,
    referer,
  };
  if (session.cookie) headers.cookie = session.cookie;
  if (session.csrf) headers['x-csrf-token'] = session.csrf;
  try {
    const direct = await fetch(`${SOURCE}/get-source?${query}`, { headers });
    const candidate = await direct.json();
    const sources = candidate.sources || candidate.data?.sources || (Array.isArray(candidate.data) ? candidate.data : []);
    if (sources.length) return { ...candidate, sources, __cookie: mergeCookies(session.cookie, cookieHeader(direct.headers)) };
  } catch (_) {}
  try {
    const bridge = await fetch(`https://r.jina.ai/http://filmmodu.one/get-source?${query}`, { headers: { 'user-agent': UA } });
    const text = await bridge.text();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const candidate = JSON.parse(text.slice(start, end + 1));
      const sources = candidate.sources || candidate.data?.sources || (Array.isArray(candidate.data) ? candidate.data : []);
      if (sources.length) return { ...candidate, sources, __cookie: session.cookie || '' };
    }
  } catch (_) {}
  return null;
}

async function resolvePlay(id, lang = 'tr', vid) {
  const { response, html, cookie: pageCookie } = await sourcePage(id);
  if (isNotFound(html, response.status)) throw new Error('Film bulunamadı.');
  const vId = vid || (html.match(/videoId\s*(?:=|:)\s*['"]([^'"]+)['"]/i)
    || html.match(/data-(?:movie-id|video-id|id)=['"]([^'"]+)['"]/i) || [])[1];
  if (!vId) throw new Error('Bu film için oynatıcı kaynağı bulunamadı.');
  const csrf = csrfToken(html);
  const types = [lang === 'en' ? 'en' : 'tr', lang === 'en' ? 'tr' : 'en', ''];
  let data;
  for (const type of types) {
    const candidate = await fetchSourceCandidate(vId, type, `${SOURCE}/${id}`, { cookie: pageCookie, csrf });
    if (candidate?.sources?.length) { data = candidate; break; }
  }
  if (!data?.sources?.length) throw new Error('Sunucu geçerli video kaynağı vermedi.');
  const usable = data.sources.filter((s) => s && (s.src || s.file || s.url));
  if (!usable.length) throw new Error('Sunucu geçerli video kaynağı vermedi.');
  const videoUrl = absoluteUrl(usable[usable.length - 1].src || usable[usable.length - 1].file || usable[usable.length - 1].url);
  const tracks = [];
  if (data.subtitle) tracks.push({ label: 'Türkçe', file: data.subtitle });
  if (Array.isArray(data.tracks)) data.tracks.forEach((t) => tracks.push({ label: t.label || 'Türkçe', file: t.file || t.src }));
  const embeddedTracks = [];
  for (const track of tracks) {
    try {
      const subResponse = await fetch(absoluteUrl(track.file), { headers: { 'user-agent': UA, cookie: mergeCookies(pageCookie, data.__cookie) } });
      if (subResponse.ok) {
        let text = (await subResponse.text()).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
        text = text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
        if (!text.includes('WEBVTT')) text = `WEBVTT\n\n${text}`;
        embeddedTracks.push({ label: track.label, data: encodeURIComponent(text) });
      }
    } catch (_) {}
  }
  return { videoUrl, embeddedTracks, cookie: mergeCookies(pageCookie, data.__cookie), isHls: /\.m3u8(?:$|\?)/i.test(videoUrl) };
}

function encodeToken(value) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(value))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeToken(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  return JSON.parse(decodeURIComponent(escape(atob(padded))));
}

function playerHtml(videoUrl, tracks, isHls) {
  const source = JSON.stringify(videoUrl);
  const embedded = JSON.stringify(tracks);
  const hlsSource = JSON.stringify(Boolean(isHls));
  return `<!doctype html>
<html lang="tr"><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><title>İnadına TV Player</title>
<link rel="stylesheet" href="https://cdn.plyr.io/3.7.8/plyr.css">
<style>html,body{margin:0;background:#000;width:100%;height:100%;height:100dvh;overflow:hidden}.plyr{width:100%;height:100%;--plyr-color-main:#e50914}video{width:100%;height:100%;object-fit:contain!important;transition:object-fit .3s}#resizeBtn{position:absolute;top:20px;left:20px;z-index:10000;background:rgba(229,9,20,.9);color:#fff;border:1px solid rgba(255,255,255,.3);border-radius:8px;padding:8px 15px;font:700 13px Arial;cursor:pointer;backdrop-filter:blur(5px);transition:opacity .4s,transform .3s}#resizeBtn:hover{background:#e50914;transform:scale(1.05)}.plyr--hide-controls #resizeBtn,.force-hide{opacity:0!important;pointer-events:none!important}@media(max-width:600px){#resizeBtn{top:15px;left:15px;font-size:11px;padding:6px 10px}}</style></head>
<body><button id="resizeBtn" type="button"><span>⛶</span> Ekran: Orijinal</button><video id="player" playsinline controls crossorigin="anonymous"></video>
<script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script><script src="https://cdn.plyr.io/3.7.8/plyr.polyfilled.js"></script>
<script>document.addEventListener('DOMContentLoaded',function(){var v=document.querySelector('#player'),btn=document.querySelector('#resizeBtn'),tracks=${embedded};tracks.forEach(function(t,i){var b=new Blob([decodeURIComponent(t.data)],{type:'text/vtt'}),x=document.createElement('track');x.kind='captions';x.label=t.label;x.srclang='tr';x.src=URL.createObjectURL(b);x.default=i===0;v.appendChild(x)});var s=${source},isHls=${hlsSource},fitModes=['contain','cover','fill'],fitNames=['Orijinal','Kırpıp Doldur','Esnet'],fit=0,hideTimer;btn.onclick=function(){fit=(fit+1)%fitModes.length;v.style.setProperty('object-fit',fitModes[fit],'important');btn.innerHTML='<span>⛶</span> Ekran: '+fitNames[fit];clearTimeout(hideTimer);hideTimer=setTimeout(function(){btn.classList.add('force-hide')},1500)};document.addEventListener('click',function(e){if(e.target!==btn&&!btn.contains(e.target))btn.classList.remove('force-hide')});var opts={captions:{active:true,language:'tr',update:true},seekTime:10};function setup(player){var first=true;player.on('play',function(){if(first&&!player.fullscreen.active){player.fullscreen.enter().catch(function(){});first=false}});player.on('enterfullscreen',function(){if(screen.orientation&&screen.orientation.lock)screen.orientation.lock('landscape').catch(function(){})});player.on('exitfullscreen',function(){if(screen.orientation&&screen.orientation.unlock)screen.orientation.unlock()})}function fail(){var box=document.createElement('div');box.style='position:fixed;inset:0;display:grid;place-items:center;background:#000;color:#fff;font:600 16px Arial;text-align:center;padding:24px;z-index:10001';box.textContent='Video kaynağı şu anda açılamıyor. Lütfen birkaç dakika sonra tekrar deneyin.';document.body.appendChild(box)}if(isHls&&Hls.isSupported()){var h=new Hls();h.loadSource(s);h.attachMedia(v);h.on(Hls.Events.MANIFEST_PARSED,function(){setup(new Plyr(v,opts))});h.on(Hls.Events.ERROR,function(_,d){if(d.fatal)fail()})}else{v.src=s;v.addEventListener('error',fail);setup(new Plyr(v,opts))}})</script></body></html>`;
}

async function play(id, lang, vid) {
  try {
    const result = await resolvePlay(id, lang, vid);
    const streamUrl = `/api/stream?token=${encodeURIComponent(encodeToken({ url: result.videoUrl, cookie: result.cookie }))}`;
    return new Response(playerHtml(streamUrl, result.embeddedTracks, result.isHls), { headers: cors({ 'Content-Type': 'text/html; charset=utf-8' }) });
  } catch (error) {
    return new Response(`Oynatıcı kaynağı alınamadı: ${error.message}`, { status: 404, headers: cors({ 'Content-Type': 'text/plain; charset=utf-8' }) });
  }
}

function streamUrlFor(url, cookie) {
  return `/api/stream?token=${encodeURIComponent(encodeToken({ url, cookie }))}`;
}

function safeStreamTarget(value) {
  const target = new URL(value);
  const host = target.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw new Error('Geçersiz akış adresi.');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('Yerel adreslere akış izni yok.');
  const ipv4 = host.split('.').map(Number);
  if (ipv4.length === 4 && ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    if (ipv4[0] === 10 || ipv4[0] === 127 || ipv4[0] === 0 || ipv4[0] === 169 && ipv4[1] === 254 || ipv4[0] === 192 && ipv4[1] === 168 || ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31) throw new Error('Yerel adreslere akış izni yok.');
  }
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:') || host.startsWith('::ffff:127.') || host.startsWith('::ffff:10.') || host.startsWith('::ffff:192.168.')) throw new Error('Yerel adreslere akış izni yok.');
  return target;
}

function rewriteManifest(manifest, target, cookie) {
  const rewrite = (value) => {
    if (!value || /^(?:data|skd):/i.test(value)) return value;
    return streamUrlFor(new URL(value, target).toString(), cookie);
  };
  return manifest
    .replace(/(\bURI\s*=\s*)(["'])(.*?)\2/gi, (match, prefix, quote, value) => `${prefix}${quote}${rewrite(value)}${quote}`)
    .split(/\r?\n/)
    .map((line) => {
      const item = line.trim();
      return !item || item.startsWith('#') ? line : rewrite(item);
    }).join('\n');
}

async function stream(request, rawToken) {
  try {
    const data = decodeToken(rawToken);
    const target = new URL(data.url);
    const safeTarget = safeStreamTarget(target.toString());
    const requestHeaders = new Headers({ 'user-agent': UA, referer: `${SOURCE}/` });
    if (data.cookie) requestHeaders.set('cookie', data.cookie);
    for (const name of ['range', 'if-range']) {
      const value = request.headers.get(name);
      if (value) requestHeaders.set(name, value);
    }
    const response = await fetch(safeTarget, { method: request.method === 'HEAD' ? 'HEAD' : 'GET', headers: requestHeaders });
    const contentType = response.headers.get('content-type') || '';
    const responseHeaders = {};
    for (const name of ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
      const value = response.headers.get(name);
      if (value) responseHeaders[name] = value;
    }
    if (!response.ok) {
      return new Response(response.body, { status: response.status, headers: cors({ ...responseHeaders, 'Content-Type': contentType || 'application/octet-stream' }) });
    }
    const isManifest = /\.m3u8(?:$|\?)/i.test(safeTarget.href) || /mpegurl/i.test(contentType);
    if (isManifest) {
      const manifest = await response.text();
      if (!manifest.trimStart().startsWith('#EXTM3U')) throw new Error('HLS oynatma listesi geçersiz.');
      const rewritten = rewriteManifest(manifest, safeTarget, data.cookie || '');
      return new Response(rewritten, { status: response.status, headers: cors({ ...responseHeaders, 'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8', 'Cache-Control': 'no-store' }) });
    }
    return new Response(response.body, { status: response.status, headers: cors({ ...responseHeaders, 'Content-Type': contentType || 'application/octet-stream', 'Cache-Control': 'no-store' }) });
  } catch (error) {
    return new Response(`Stream proxy error: ${error.message}`, { status: 502, headers: cors({ 'Content-Type': 'text/plain; charset=utf-8' }) });
  }
}

async function subtitle(rawUrl) {
  const url = absoluteUrl(decodeURIComponent(rawUrl));
  const response = await fetch(url, { headers: { 'user-agent': UA, referer: `${SOURCE}/` } });
  if (!response.ok) return new Response('Altyazı bulunamadı.', { status: 404, headers: cors() });
  let text = await response.text();
  if (!text.includes('WEBVTT')) text = `WEBVTT\n\n${text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')}`;
  return new Response(text, { headers: cors({ 'Content-Type': 'text/vtt; charset=utf-8' }) });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    try {
      if (path === '/api/info') return await info(url.searchParams.get('id'), url.searchParams.get('vid'));
      if (path === '/api/play') return await play(url.searchParams.get('id'), url.searchParams.get('lang'), url.searchParams.get('vid'));
      if (path === '/api/stream') return await stream(request, url.searchParams.get('token') || '');
      if (path === '/api/sub') return await subtitle(url.searchParams.get('url'));
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return json({ ok: true, service: 'inadina-tv-player-api' });
    } catch (error) {
      return json({ error: error.message }, 500);
    }
  },
};
