export default async function handler(req, res) {
  const { id } = req.query;
  try {
    const pageReq = await fetch(`https://www.filmmodu.one/${id}`, {
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
    });
    const html = await pageReq.text();

    // HTML entity'leri coz (&#039; &amp; vs.)
    const decode = (s) => s
      .replace(/&#0*(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
      .replace(/&#x0*([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
      .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ").trim();

    const desc = decode((html.match(/<meta property="og:description" content="([^"]+)"/) || ["", "Film açıklaması yüklenemedi."])[1]);

    let languages = [];

    // Sadece gercek film sayfalarina giden linkler kabul edilir
    const isMovieSlug = (s) => !!s && /^[^\s"'<>\\]+-film-izle$/.test(s);

    // 1. Link Tabanlı Dil Seçenekleri
    const linkRegex = /<a[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/gi;
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      const text = match[2].trim().replace(/(<([^>]+)>)/gi, "");
      const tLower = text.toLowerCase();

      if (tLower.includes("filmler") || tLower.includes("fragman")) continue;

      if ((tLower.includes("dublaj") || tLower.includes("altyaz")) && tLower.length < 30) {
        let slug = match[1].split('/').pop();
        if (isMovieSlug(slug) && !languages.find(l => l.slug === slug)) {
          // Altyazıysa 'en', dublajsa 'tr' etiketini linke ekliyoruz
          let langCode = tLower.includes("altyaz") ? "en" : "tr";
          languages.push({ url: `/api/play?id=${encodeURIComponent(slug)}&lang=${langCode}`, name: text, slug });
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
        const key = "vid-" + match[1];
        if (!languages.find(l => l.slug === key)) {
          // Dil etiketini ekliyoruz
          let langCode = tLower.includes("altyaz") ? "en" : "tr";
          languages.push({ url: `/api/play?id=${encodeURIComponent(id)}&vid=${encodeURIComponent(match[1])}&lang=${langCode}`, name: text, slug: key });
        }
      }
    }

    if (languages.length === 0) {
      languages.push({ url: `/api/play?id=${encodeURIComponent(id)}&lang=tr`, name: "FİLMİ İZLE" });
    }

    // Ic kullanim alanini (slug) disari sizdirma
    languages = languages.map(({ url, name }) => ({ url, name }));

    res.status(200).json({ desc, languages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
