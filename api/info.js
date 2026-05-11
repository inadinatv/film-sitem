export default async function handler(req, res) {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: "ID eksik" });

  try {
    const pageReq = await fetch(`https://www.filmmodu.one/${id}`, {
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
    });
    const html = await pageReq.text();

    // 1. Film Açıklamasını Meta Etiketlerinden Kusursuz Çekme
    let desc = "Film açıklaması bulunamadı.";
    const metaMatch = html.match(/<meta property="og:description" content="([^"]+)"/) || 
                      html.match(/<meta name="description" content="([^"]+)"/);
    if (metaMatch) {
        desc = metaMatch[1];
    } else {
        const pMatch = html.match(/Film Özeti:.*?<p>(.*?)<\/p>/is);
        if (pMatch) desc = pMatch[1].replace(/(<([^>]+)>)/gi, "");
    }

    // 2. Filmmodu'nun İçindeki Dil Seçeneklerini (Dublaj/Altyazı) Bulma
    let languages = [];
    const langRegex = /<[^>]+data-(?:movie-id|id)="([^"]+)"[^>]*>(.*?)<\/[^>]+>/gi;
    let match;
    
    while ((match = langRegex.exec(html)) !== null) {
        const vId = match[1];
        const text = match[2].trim().replace(/(<([^>]+)>)/gi, ""); 
        if (text.toLowerCase().includes("dublaj") || text.toLowerCase().includes("altyaz")) {
            if(!languages.find(l => l.vId === vId)) {
                languages.push({ vId, name: text });
            }
        }
    }

    // Eğer dil butonu yoksa varsayılan videoyu al
    const defVidMatch = html.match(/videoId\s*=\s*'([^']+)'/) || html.match(/data-movie-id="([^"]+)"/);
    const defaultVid = defVidMatch ? defVidMatch[1] : null;

    if (languages.length === 0 && defaultVid) {
        let name = id.includes("altyazi") ? "Türkçe Altyazılı" : (id.includes("dublaj") ? "Türkçe Dublaj" : "Varsayılan Dil (Orjinal)");
        languages.push({ vId: defaultVid, name: name });
    }

    res.status(200).json({ desc, languages });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
