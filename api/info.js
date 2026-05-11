export default async function handler(req, res) {
  const { id } = req.query;
  try {
    const pageReq = await fetch(`https://www.filmmodu.one/${id}`, {
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
    });
    const html = await pageReq.text();
    const desc = (html.match(/<meta property="og:description" content="([^"]+)"/) || ["", "Film açıklaması yüklenemedi."])[1];

    let languages = [];
    
    // 1. Link Tabanlı Dil Seçenekleri
    const linkRegex = /<a[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/gi;
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
        const text = match[2].trim().replace(/(<([^>]+)>)/gi, "");
        const tLower = text.toLowerCase();
        
        if (tLower.includes("filmler") || tLower.includes("fragman")) continue;

        if ((tLower.includes("dublaj") || tLower.includes("altyaz")) && tLower.length < 30) {
            let slug = match[1].split('/').pop();
            if (slug && !slug.includes("hd-film-izle") && !slug.includes("altyazili-filmler")) {
                if (!languages.find(l => l.name === text)) {
                    // YENİ: Altyazıysa 'en', dublajsa 'tr' etiketini linke ekliyoruz
                    let langCode = tLower.includes("altyaz") ? "en" : "tr";
                    languages.push({ url: `/api/play?id=${slug}&lang=${langCode}`, name: text });
                }
            }
        }
    }

    // 2. Ajax Tabanlı Dil Seçenekleri
    const btnRegex = /<[^>]+data-(?:movie-id|id)="([^"]+)"[^>]*>(.*?)<\/[^>]+>/gi;
    while ((match = btnRegex.exec(html)) !== null) {
        const text = match[2].trim().replace(/(<([^>]+)>)/gi, "");
        const tLower = text.toLowerCase();
        
        if (tLower.includes("filmler") || tLower.includes("fragman")) continue;

        if ((tLower.includes("dublaj") || tLower.includes("altyaz")) && tLower.length < 30) {
            if(!languages.find(l => l.name === text)) {
                // YENİ: Dil etiketini ekliyoruz
                let langCode = tLower.includes("altyaz") ? "en" : "tr";
                languages.push({ url: `/api/play?id=${id}&vid=${match[1]}&lang=${langCode}`, name: text });
            }
        }
    }

    if(languages.length === 0) {
        languages.push({ url: `/api/play?id=${id}&lang=tr`, name: "FİLMİ İZLE" });
    }

    res.status(200).json({ desc, languages });
  } catch (err) { 
    res.status(500).json({ error: err.message }); 
  }
}
