export default async function handler(req, res) {
  const { id } = req.query;
  try {
    const pageReq = await fetch(`https://www.filmmodu.one/${id}`, {
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
    });
    const html = await pageReq.text();
    const desc = (html.match(/<meta property="og:description" content="([^"]+)"/) || ["", "Açıklama yükleniyor..."])[1];

    let languages = [];
    
    // 1. Linkleri (SEO) Tara
    const linkRegex = /<a[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/gi;
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
        const text = match[2].trim().replace(/(<([^>]+)>)/gi, "");
        const tLower = text.toLowerCase();
        if ((tLower.includes("dublaj") || tLower.includes("altyaz")) && tLower.length < 25) {
            let slug = match[1].split('/').pop();
            if (slug && !languages.find(l => l.name === text)) {
                languages.push({ url: `/api/play?id=${slug}`, name: text });
            }
        }
    }

    // 2. Ajax ID'lerini Tara
    const btnRegex = /<[^>]+data-(?:movie-id|id)="([^"]+)"[^>]*>(.*?)<\/[^>]+>/gi;
    while ((match = btnRegex.exec(html)) !== null) {
        const text = match[2].trim().replace(/(<([^>]+)>)/gi, "");
        if ((text.toLowerCase().includes("dublaj") || text.toLowerCase().includes("altyaz")) && text.length < 25) {
            if(!languages.find(l => l.name === text)) {
                languages.push({ url: `/api/play?id=${id}&vid=${match[1]}`, name: text });
            }
        }
    }

    if(languages.length === 0) languages.push({ url: `/api/play?id=${id}`, name: "VARSAYILAN DİLDE İZLE" });

    res.status(200).json({ desc, languages });
  } catch (err) { res.status(500).json({ error: err.message }); }
}
