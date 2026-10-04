const UPSTREAM = 'https://inadina-tv-player-api.burhantasci72.workers.dev';

export default async (request) => {
  const incoming = new URL(request.url);
  const path = incoming.pathname.replace(/^\/\.netlify\/functions\/api/, '') || '/';
  const target = `${UPSTREAM}/api${path}${incoming.search}`;

  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.set('user-agent', headers.get('user-agent') || 'Mozilla/5.0');

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    });

    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.set('access-control-allow-origin', '*');
    responseHeaders.set('cache-control', 'no-store');

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Player API proxy unavailable', detail: String(error) }), {
      status: 502,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
};
