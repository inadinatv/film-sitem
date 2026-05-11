export default async function handler(req, res) {
  const { id } = req.query;
  if (!id) return res.status(400).send("Film ID eksik.");

  try {
    const pageReq = await fetch(`https://www.filmmodu.one/${id}`, {
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0)", "referer": "https://www.filmmodu.one/" }
    });
    const html = await pageReq.text();

    const videoId = (html.match(/videoId = '(.*?)'/) || [])[1];
    const csrfToken = (html.match(/"csrf-token" content="(.*?)"/) || [])[1];

    if (!videoId || !csrfToken) return res.status(500).send("Video engeline takıldı.");

    const sourceReq = await fetch(`https://www.filmmodu.one/get-source?movie_id=${videoId}&type=en`, {
      headers: { "x-csrf-token": csrfToken, "x-requested-with": "XMLHttpRequest", "referer": `https://www.filmmodu.one/${id}` }
    });

    const data = await sourceReq.json();
    const lastQuality = data.sources[data.sources.length - 1];

    if (!lastQuality || !lastQuality.src) return res.status(404).send("Link bulunamadı.");

    // Videonun asıl mp4/m3u8 adresine yönlendir (Cloudflare Worker'ın yaptığı iş)
    res.redirect(302, lastQuality.src);

  } catch (err) {
    res.status(500).send("Hata: " + err.message);
  }
}
