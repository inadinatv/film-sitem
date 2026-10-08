const SOURCE = 'https://www.filmmodu.one';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36';
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const FORWARDED_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'];

export const config = { runtime: 'edge' };

function safeTarget(value) {
  const target = new URL(value);
  const host = target.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
    throw new Error('Geçersiz video adresi.');
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('Yerel adreslere video erişimi kapalı.');
  }
  const ip = host.split('.').map(Number);
  if (ip.length === 4 && ip.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    const [a, b] = ip;
    if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19))) {
      throw new Error('Yerel adreslere video erişimi kapalı.');
    }
  }
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:') || host.startsWith('::ffff:127.') || host.startsWith('::ffff:10.') || host.startsWith('::ffff:192.168.')) {
    throw new Error('Yerel adreslere video erişimi kapalı.');
  }
  return target;
}

function encodeBase64Url(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function proxiedUrl(url, cookie, referer, origin) {
  const token = encodeBase64Url(JSON.stringify({ url, cookie: cookie || '', referer: referer || `${SOURCE}/` }));
  return `${new URL('/api/stream', origin).href}?token=${encodeURIComponent(token)}`;
}

function rewriteManifest(text, baseUrl, cookie, origin) {
  const rewrite = (value) => {
    if (!value || /^(?:data|skd):/i.test(value)) return value;
    try {
      return proxiedUrl(new URL(value, baseUrl).toString(), cookie, baseUrl, origin);
    } catch (_) {
      return value;
    }
  };
  return text
    .replace(/(\bURI\s*=\s*)(["'])(.*?)\2/gi, (match, prefix, quote, value) => `${prefix}${quote}${rewrite(value)}${quote}`)
    .split(/\r?\n/)
    .map((line) => {
      const item = line.trim();
      return !item || item.startsWith('#') ? line : rewrite(item);
    })
    .join('\n');
}

function responseHeaders(upstream) {
  const headers = new Headers({ 'cache-control': 'no-store' });
  for (const name of FORWARDED_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

function errorResponse(status, message) {
  return new Response(message, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export default async function handler(request) {
  const method = request.method.toUpperCase();
  if (!['GET', 'HEAD'].includes(method)) {
    return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET, HEAD', 'cache-control': 'no-store' } });
  }

  const requestUrl = new URL(request.url);
  const rawToken = requestUrl.searchParams.get('token');
  if (!rawToken) return errorResponse(400, 'Stream token eksik.');
  if (rawToken.length > 24000) return errorResponse(400, 'Stream token geçersiz.');

  let data;
  try {
    data = JSON.parse(decodeBase64Url(rawToken));
  } catch (_) {
    return errorResponse(400, 'Stream token geçersiz.');
  }
  if (!data || typeof data.url !== 'string') return errorResponse(400, 'Stream token geçersiz.');

  try {
    let target = safeTarget(data.url);
    const cookie = typeof data.cookie === 'string' ? data.cookie.slice(0, 8192) : '';
    let referer = `${SOURCE}/`;
    if (typeof data.referer === 'string' && data.referer) referer = safeTarget(data.referer).href;

    const headers = new Headers({
      'user-agent': UA,
      referer,
      'accept-encoding': 'identity',
    });
    if (cookie) headers.set('cookie', cookie);
    const range = request.headers.get('range');
    const ifRange = request.headers.get('if-range');
    if (range) headers.set('range', range);
    if (ifRange) headers.set('if-range', ifRange);

    let upstream;
    for (let redirects = 0; redirects <= 4; redirects += 1) {
      upstream = await fetch(target.href, { method, headers, redirect: 'manual' });
      const location = upstream.headers.get('location');
      if (!REDIRECT_STATUSES.has(upstream.status) || !location) break;
      if (upstream.body) {
        try { await upstream.body.cancel(); } catch (_) {}
      }
      if (redirects === 4) throw new Error('Video kaynağı çok fazla yönlendirme yaptı.');
      target = safeTarget(new URL(location, target).href);
    }

    const finalUrl = safeTarget(upstream.url || target.href);
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    const isManifest = /\.m3u8(?:$|\?)/i.test(finalUrl.href) || /mpegurl/i.test(contentType);
    const headersOut = responseHeaders(upstream);

    if (!upstream.ok) {
      const body = method === 'HEAD' || [204, 205, 304].includes(upstream.status) ? null : upstream.body;
      return new Response(body, { status: upstream.status, headers: headersOut });
    }

    if (method === 'HEAD' || !upstream.body) {
      return new Response(null, { status: upstream.status, headers: headersOut });
    }

    if (isManifest) {
      const manifest = (await upstream.text()).replace(/^\uFEFF/, '');
      if (!manifest.trimStart().startsWith('#EXTM3U')) {
        return errorResponse(502, 'Yayın sağlayıcısı geçerli bir HLS listesi vermedi.');
      }
      return new Response(rewriteManifest(manifest, finalUrl.href, cookie, requestUrl.origin), {
        status: upstream.status,
        headers: {
          'content-type': 'application/vnd.apple.mpegurl; charset=utf-8',
          'cache-control': 'no-store',
        },
      });
    }

    const body = [204, 205, 304].includes(upstream.status) ? null : upstream.body;
    return new Response(body, { status: upstream.status, headers: headersOut });
  } catch (error) {
    return errorResponse(502, `Stream proxy error: ${error?.message || 'Bilinmeyen hata.'}`);
  }
}
