import worker from '../../worker/src/index.js';

export default async (request) => {
  const incoming = new URL(request.url);
  const functionPath = incoming.pathname.replace(/^\/\.netlify\/functions\/api/, '') || '/';
  const apiPath = functionPath.startsWith('/api/') || functionPath === '/api'
    ? functionPath
    : `/api${functionPath}`;
  const target = new URL(apiPath + incoming.search, incoming.origin);

  const headers = new Headers(request.headers);
  headers.delete('host');

  const proxiedRequest = new Request(target, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
  });

  try {
    return await worker.fetch(proxiedRequest, {});
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error?.message || error) }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
};
