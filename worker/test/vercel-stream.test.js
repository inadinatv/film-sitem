import test from 'node:test';
import assert from 'node:assert/strict';
import vercelStream, { config as streamConfig } from '../../api/stream.mjs';

function token(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

async function invoke(data, { headers = {}, method = 'GET' } = {}) {
  const url = new URL('https://app.example/api/stream');
  url.searchParams.set('token', token(data));
  return vercelStream(new Request(url, { method, headers }));
}

test('Vercel stream proxy is configured for the Edge runtime', () => {
  assert.equal(streamConfig.runtime, 'edge');
});

test('Edge proxy rewrites HLS segment and key URIs to same-origin routes and carries the parent manifest Referer', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response([
    '#EXTM3U',
    '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.bin"',
    '#EXTINF:5,',
    'segment.ts',
    '',
  ].join('\n'), { headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
  try {
    const res = await invoke({
      url: 'https://media.example/path/master.m3u8',
      cookie: 'sid=abc',
      referer: 'https://www.filmmodu.one/sample-film-izle',
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /mpegurl/);
    const text = await res.text();
    const paths = [...text.matchAll(/\/api\/stream\?token=([^\s"\n]+)/g)];
    const decoded = paths.map((match) => JSON.parse(Buffer.from(decodeURIComponent(match[1]), 'base64url').toString('utf8')));
    assert.deepEqual(decoded.map((item) => item.url), [
      'https://media.example/path/keys/key.bin',
      'https://media.example/path/segment.ts',
    ]);
    assert.ok(decoded.every((item) => item.cookie === 'sid=abc'));
    assert.ok(decoded.every((item) => item.referer === 'https://media.example/path/master.m3u8'));
    assert.match(text, /https:\/\/app\.example\/api\/stream\?token=/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Edge proxy forwards Range and If-Range and streams 206 video bytes', async () => {
  const originalFetch = globalThis.fetch;
  let forwardedRange;
  let forwardedIfRange;
  globalThis.fetch = async (_url, init) => {
    const headers = new Headers(init.headers);
    forwardedRange = headers.get('range');
    forwardedIfRange = headers.get('if-range');
    return new Response(new Uint8Array([71, 64, 17]), {
      status: 206,
      headers: { 'content-type': 'video/mp2t', 'content-range': 'bytes 0-2/8', 'accept-ranges': 'bytes' },
    });
  };
  try {
    const res = await invoke({ url: 'https://media.example/segment.ts' }, {
      headers: { range: 'bytes=0-2', 'if-range': '"etag-1"' },
    });
    assert.equal(forwardedRange, 'bytes=0-2');
    assert.equal(forwardedIfRange, '"etag-1"');
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('content-range'), 'bytes 0-2/8');
    assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [71, 64, 17]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Edge proxy rejects private network destinations', async () => {
  const res = await invoke({ url: 'http://127.0.0.1/private' });
  assert.equal(res.status, 502);
  assert.match(await res.text(), /Yerel adreslere video erişimi kapalı/);
});

test('Edge proxy rejects successful responses that are not valid HLS manifests', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('404', { headers: { 'content-type': 'application/x-mpegURL' } });
  try {
    const res = await invoke({ url: 'https://media.example/master.m3u8' });
    assert.equal(res.status, 502);
    assert.match(await res.text(), /geçerli bir HLS listesi/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
