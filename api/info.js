export default async function handler(req, res) {
  const { id } = req.query;
  try {
    const pageReq = await fetch(`https://www.filmmodu.one/${id}`, {
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
    });
    const html = await pageReq.text();

    // Özet çekme
    const desc = (html.match(/<meta property="og:description" content="([^"]+)"/) || ["", "Açıklama bulunamadı."])[1];

    // Dublaj ve Altyazı butonlarını ID'leri ile yakalama
    let languages = [];
    const btnRegex = /<[^>]+data-(?:movie-id|id)="([^"]+)"[^>]*>(.*?)<\/[^>]+>/gi;
    let match;
    while ((match = btnRegex.exec(html)) !== null) {
        const vId = match[1];
        const label = match[2].trim().replace(/(<([^>]+)>)/gi, "");
        if (label.toLowerCase().includes("dublaj") || label.toLowerCase().includes("altyaz")) {
            if(!languages.find(l => l.vId === vId)) languages.push({ vId, name: label });
        }
    }

    if(languages.length === 0) {
        const defId = (html.match(/videoId\s*=\s*'([^']+)'/) || html.match(/data-movie-id="([^"]+)"/) || [])[1];
        if(defId) languages.push({ vId: defId, name: "Filmi İzle" });
    }

    res.status(200).json({ desc, languages });
  } catch (err) { res.status(500).json({ error: err.message }); }
}
