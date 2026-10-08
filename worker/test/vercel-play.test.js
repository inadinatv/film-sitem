import test from 'node:test';
import assert from 'node:assert/strict';
import vercelPlay from '../../api/play.js';

class TestResponse {
  constructor() {
    this.headers = new Map();
    this.statusCode = 200;
    this.body = '';
  }
  setHeader(name, value) {
    this.headers.set(name.toLowerCase(), value);
    return this;
  }
  status(code) {
    this.statusCode = code;
    return this;
  }
  send(body) {
    this.body = String(body);
    return this;
  }
}

test('Vercel play page detects extensionless imgsapi HLS and points at its own stream route', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.pathname === '/sample-film-izle') {
      return new Response('<html><script>videoId = "sample-123";</script></html>', {
        headers: { 'set-cookie': 'page_session=one; Path=/; HttpOnly' },
      });
    }
    if (url.pathname === '/get-source') {
      return Response.json({ sources: [{ src: '//imgsapi.pro/path/master?token=xyz', type: 'hls' }] }, {
        headers: { 'set-cookie': 'stream_session=two; Path=/; HttpOnly' },
      });
    }
    throw new Error(`Unexpected fetch: ${url.href}`);
  };
  try {
    const res = new TestResponse();
    await vercelPlay({ query: { id: 'sample-film-izle', lang: 'tr' } }, res);
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /const isHls = true/);
    assert.match(res.body, /const source = "\/api\/stream\?token=/);
    const match = res.body.match(/const source = "\/api\/stream\?token=([^\"]+)"/);
    assert.ok(match, 'expected a Vercel same-origin stream URL');
    const encoded = decodeURIComponent(match[1]);
    const token = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    assert.equal(token.url, 'https://imgsapi.pro/path/master.m3u8?token=xyz');
    assert.equal(token.cookie, 'page_session=one; stream_session=two');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
