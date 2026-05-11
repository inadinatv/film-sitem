export default async function handler(req, res) {
  const { id } = req.query;
  try {
    const pageReq = await fetch(`https://www.filmmodu.one/${id}`, {
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
    });
    const html = await pageReq.text();

    const desc = (html.match(/<meta property="og:description" content="([^"]+)"/) || ["", "Açıklama bulunamadı."])[1];

    let languages = [];
    
    // 1. Link (SEO) tabanlı dil butonları
    const linkRegex = /<a[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/gi;
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
        const href = match[1];
        const text = match[2].trim().replace(/(<([^>]+)>)/gi, "");
        const tLower = text.toLowerCase();
        
        // Sadece buton olanları alır, kategori linklerine atlamaz
        if (tLower.length < 25 && (tLower.includes("dublaj") || tLower.includes("altyaz")) && !tLower.includes("fragman")) {
            let slug = href.split('/').pop();
            if (slug && !languages.find(l => l.name === text)) {
                languages.push({ url: `/api/play?id=${slug}`, name: text });
            }
        }
    }

    // 2. Ajax tabanlı dil butonları
    const btnRegex = /<[^>]+data-(?:movie-id|id)="([^"]+)"[^>]*>(.*?)<\/[^>]+>/gi;
    while ((match = btnRegex.exec(html)) !== null) {
        const vId = match[1];
        const text = match[2].trim().replace(/(<([^>]+)>)/gi, "");
        if (text.length < 25 && (text.toLowerCase().includes("dublaj") || text.toLowerCase().includes("altyaz")) && !text.toLowerCase().includes("fragman")) {
            if(!languages.find(l => l.name === text)) {
                languages.push({ url: `/api/play?id=${id}&vid=${vId}`, name: text });
            }
        }
    }

    if(languages.length === 0) {
        languages.push({ url: `/api/play?id=${id}`, name: "FİLMİ İZLE" });
    }

    res.status(200).json({ desc, languages });
  } catch (err) { res.status(500).json({ error: err.message }); }
}
