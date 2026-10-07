import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

function encodeToken(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function streamRequest(value, headers = {}) {
  const token = encodeToken(value);
  return new Request(`https://worker.test/api/stream?token=${encodeURIComponent(token)}`, { headers });
}

function decodeToken(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

test('HLS manifest rewrites segment, encryption-key, and initialization-map URLs', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    assert.equal(new URL(input).href, 'https://media.example/path/master.m3u8');
    return new Response([
      '#EXTM3U',
      '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.bin"',
      '#EXT-X-MAP:URI="init.mp4"',
      '#EXTINF:4,',
      'segments/001.ts',
      '',
    ].join('\n'), { headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
  };
  try {
    const response = await worker.fetch(streamRequest({ url: 'https://media.example/path/master.m3u8', cookie: 'session=abc' }), {});
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /mpegurl/);
    const manifest = await response.text();
    const urls = [...manifest.matchAll(/(?:URI=")?\/api\/stream\?token=([^\s"\n]+)/g)]
      .map((match) => decodeToken(new URLSearchParams(`token=${match[1]}`).get('token')));
    assert.deepEqual(urls.map((item) => item.url), [
      'https://media.example/path/keys/key.bin',
      'https://media.example/path/init.mp4',
      'https://media.example/path/segments/001.ts',
    ]);
    assert.ok(urls.every((item) => item.cookie === 'session=abc'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('video segments stream through while preserving byte ranges and partial-content headers', async () => {
  const originalFetch = globalThis.fetch;
  let forwardedRange;
  globalThis.fetch = async (_input, init) => {
    forwardedRange = new Headers(init.headers).get('range');
    return new Response(new Uint8Array([1, 2, 3, 4]), {
      status: 206,
      headers: { 'content-type': 'video/mp2t', 'content-range': 'bytes 5-8/10', 'accept-ranges': 'bytes' },
    });
  };
  try {
    const response = await worker.fetch(streamRequest({ url: 'https://media.example/segment.ts' }, { Range: 'bytes=5-8' }), {});
    assert.equal(forwardedRange, 'bytes=5-8');
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), 'bytes 5-8/10');
    assert.equal(response.headers.get('accept-ranges'), 'bytes');
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3, 4]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('stream proxy rejects localhost targets', async () => {
  const response = await worker.fetch(streamRequest({ url: 'http://127.0.0.1/private' }), {});
  assert.equal(response.status, 502);
  assert.match(await response.text(), /Yerel adreslere akış izni yok/);
});

test('player detects HLS from the upstream source, not the opaque proxy URL', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.hostname === 'filmmodu.one' && url.pathname === '/sample-film-izle') {
      return new Response('<html><title>Sample</title><script>videoId = "movie-123";</script></html>');
    }
    if (url.hostname === 'filmmodu.one' && url.pathname === '/get-source') {
      return Response.json({ sources: [{ src: 'https://media.example/master.m3u8' }] });
    }
    throw new Error(`Unexpected test fetch: ${url.href}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.test/api/play?id=sample-film-izle&lang=tr'), {});
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /isHls=true/);
    assert.match(html, /if\(isHls&&Hls\.isSupported\(\)\)/);
    assert.match(html, /h\.loadSource\(s\)/);
    assert.match(html, /\/api\/stream\?token=/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
