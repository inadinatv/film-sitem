export default async function handler(req, res) {
  const { id } = req.query;
  try {
    const pageReq = await fetch(`https://www.filmmodu.one/${id}`, {
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
    });
    const html = await pageReq.text();
    const desc = (html.match(/<meta property="og:description" content="([^"]+)"/) || ["", "Film açıklaması yüklenemedi."])[1];

    let languages = [];
    
    // 1. Link (SEO) Tabanlı Dil Seçenekleri
    const linkRegex = /<a[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/gi;
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
        const text = match[2].trim().replace(/(<([^>]+)>)/gi, "");
        const tLower = text.toLowerCase();
        
        // HATA ÇÖZÜMÜ: Eğer kelimede "filmler" (çoğul) veya "fragman" geçiyorsa bu üst menüdür, kesinlikle atla!
        if (tLower.includes("filmler") || tLower.includes("fragman")) continue;

        if ((tLower.includes("dublaj") || tLower.includes("altyaz")) && tLower.length < 30) {
            let slug = match[1].split('/').pop();
            
            // Ekstra Güvenlik: Slug (link) genel bir kategori sayfası olmasın
            if (slug && !slug.includes("hd-film-izle") && !slug.includes("altyazili-filmler")) {
                if (!languages.find(l => l.name === text)) {
                    languages.push({ url: `/api/play?id=${slug}`, name: text });
                }
            }
        }
    }

    // 2. Ajax Tabanlı Dil Seçenekleri (Aynı sayfa içi butonlar)
    const btnRegex = /<[^>]+data-(?:movie-id|id)="([^"]+)"[^>]*>(.*?)<\/[^>]+>/gi;
    while ((match = btnRegex.exec(html)) !== null) {
        const text = match[2].trim().replace(/(<([^>]+)>)/gi, "");
        const tLower = text.toLowerCase();
        
        // Menü ve fragman koruması burada da geçerli
        if (tLower.includes("filmler") || tLower.includes("fragman")) continue;

        if ((tLower.includes("dublaj") || tLower.includes("altyaz")) && tLower.length < 30) {
            if(!languages.find(l => l.name === text)) {
                languages.push({ url: `/api/play?id=${id}&vid=${match[1]}`, name: text });
            }
        }
    }

    // Eğer sitede hiçbir dil butonu yoksa (Tek dilli filmler için) düz "Filmi İzle" butonu ekle
    if(languages.length === 0) {
        languages.push({ url: `/api/play?id=${id}`, name: "FİLMİ İZLE" });
    }

    res.status(200).json({ desc, languages });
  } catch (err) { 
    res.status(500).json({ error: err.message }); 
  }
}
