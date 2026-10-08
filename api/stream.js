import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const SOURCE = 'https://www.filmmodu.one';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36';

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
    if (a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19)) {
      throw new Error('Yerel adreslere video erişimi kapalı.');
    }
  }
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:') || host.startsWith('::ffff:127.') || host.startsWith('::ffff:10.') || host.startsWith('::ffff:192.168.')) {
    throw new Error('Yerel adreslere video erişimi kapalı.');
  }
  return target;
}

function proxiedUrl(url, cookie) {
  const token = Buffer.from(JSON.stringify({ url, cookie: cookie || '' }), 'utf8').toString('base64url');
  return `/api/stream?token=${encodeURIComponent(token)}`;
}

function rewriteManifest(text, baseUrl, cookie) {
  const rewrite = (value) => {
    if (!value || /^(?:data|skd):/i.test(value)) return value;
    return proxiedUrl(new URL(value, baseUrl).toString(), cookie);
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

function forwardHeaders(response, res) {
  for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
    const value = response.headers.get(name);
    if (value) res.setHeader(name, value);
  }
  res.setHeader('Cache-Control', 'no-store');
}

export default async function handler(req, res) {
  if (!['GET', 'HEAD'].includes(req.method || 'GET')) {
    return res.status(405).setHeader('Allow', 'GET, HEAD').send('Method Not Allowed');
  }

  try {
    const rawToken = Array.isArray(req.query?.token) ? req.query.token[0] : req.query?.token;
    if (!rawToken) return res.status(400).send('Stream token eksik.');
    const data = JSON.parse(Buffer.from(String(rawToken), 'base64url').toString('utf8'));
    let target = safeTarget(data.url);
    const headers = new Headers({ 'user-agent': UA, referer: `${SOURCE}/` });
    if (data.cookie) headers.set('cookie', String(data.cookie));
    if (req.headers?.range) headers.set('range', req.headers.range);
    if (req.headers?.['if-range']) headers.set('if-range', req.headers['if-range']);

    let upstream;
    for (let redirects = 0; redirects <= 4; redirects += 1) {
      upstream = await fetch(target, { method: req.method === 'HEAD' ? 'HEAD' : 'GET', headers, redirect: 'manual' });
      const location = upstream.headers.get('location');
      if (![301, 302, 303, 307, 308].includes(upstream.status) || !location) break;
      if (upstream.body) await upstream.body.cancel().catch(() => {});
      if (redirects === 4) throw new Error('Video kaynağı çok fazla yönlendirme yaptı.');
      target = safeTarget(new URL(location, target).toString());
    }

    const finalUrl = safeTarget(upstream.url || target.toString());
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    const isManifest = /\.m3u8(?:$|\?)/i.test(finalUrl.href) || /mpegurl/i.test(contentType);

    if (!upstream.ok) {
      forwardHeaders(upstream, res);
      res.status(upstream.status);
      if (upstream.body && req.method !== 'HEAD') await pipeline(Readable.fromWeb(upstream.body), res);
      else res.end();
      return;
    }

    if (isManifest) {
      const manifest = (await upstream.text()).replace(/^\uFEFF/, '');
      if (!manifest.trimStart().startsWith('#EXTM3U')) {
        return res.status(502).setHeader('Content-Type', 'text/plain; charset=utf-8').send('Yayın sağlayıcısı geçerli bir HLS listesi vermedi.');
      }
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(upstream.status).send(rewriteManifest(manifest, finalUrl, data.cookie || ''));
    }

    forwardHeaders(upstream, res);
    res.status(upstream.status);
    if (upstream.body && req.method !== 'HEAD') await pipeline(Readable.fromWeb(upstream.body), res);
    else res.end();
  } catch (error) {
    if (res.headersSent) {
      res.destroy(error);
      return;
    }
    return res.status(502).setHeader('Content-Type', 'text/plain; charset=utf-8').send(`Stream proxy error: ${error.message}`);
  }
}
