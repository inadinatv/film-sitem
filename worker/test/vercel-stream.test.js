import test from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import vercelStream from '../../api/stream.js';

function token(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

class TestResponse extends Writable {
  constructor() {
    super();
    this.chunks = [];
    this.headers = new Map();
    this.statusCode = 200;
  }
  _write(chunk, _encoding, callback) {
    this.chunks.push(Buffer.from(chunk));
    callback();
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
    this.end(body);
    return this;
  }
  text() {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}

async function invoke(data, { headers = {}, method = 'GET' } = {}) {
  const res = new TestResponse();
  const finished = new Promise((resolve, reject) => {
    res.once('finish', resolve);
    res.once('error', reject);
  });
  await vercelStream({ method, query: { token: token(data) }, headers }, res);
  await finished;
  return res;
}

test('Vercel proxy rewrites HLS segment and key URIs to same-origin routes', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response([
    '#EXTM3U',
    '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.bin"',
    '#EXTINF:5,',
    'segment.ts',
    '',
  ].join('\n'), { headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
  try {
    const res = await invoke({ url: 'https://media.example/path/master.m3u8', cookie: 'sid=abc' });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers.get('content-type'), /mpegurl/);
    const paths = [...res.text().matchAll(/\/api\/stream\?token=([^\s"\n]+)/g)];
    const decoded = paths.map((match) => JSON.parse(Buffer.from(decodeURIComponent(match[1]), 'base64url').toString('utf8')));
    assert.deepEqual(decoded.map((item) => item.url), [
      'https://media.example/path/keys/key.bin',
      'https://media.example/path/segment.ts',
    ]);
    assert.ok(decoded.every((item) => item.cookie === 'sid=abc'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Vercel proxy forwards Range and streams 206 video bytes', async () => {
  const originalFetch = globalThis.fetch;
  let forwardedRange;
  globalThis.fetch = async (_url, init) => {
    forwardedRange = new Headers(init.headers).get('range');
    return new Response(new Uint8Array([71, 64, 17]), {
      status: 206,
      headers: { 'content-type': 'video/mp2t', 'content-range': 'bytes 0-2/8', 'accept-ranges': 'bytes' },
    });
  };
  try {
    const res = await invoke({ url: 'https://media.example/segment.ts' }, { headers: { range: 'bytes=0-2' } });
    assert.equal(forwardedRange, 'bytes=0-2');
    assert.equal(res.statusCode, 206);
    assert.equal(res.headers.get('content-range'), 'bytes 0-2/8');
    assert.deepEqual([...Buffer.concat(res.chunks)], [71, 64, 17]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Vercel proxy rejects private network destinations', async () => {
  const res = await invoke({ url: 'http://127.0.0.1/private' });
  assert.equal(res.statusCode, 502);
  assert.match(res.text(), /Yerel adreslere video erişimi kapalı/);
});
