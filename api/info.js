export default async function handler(req, res) {
  const { id } = req.query;
  if (!id) {
    return res.status(400).json({ error: "Film ID eksik." });
  }

  try {
    const pageReq = await fetch(`https://www.filmmodu.one/${id}`, {
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
    });

    if (pageReq.status === 404) {
      return res.status(404).json({ exists: false, error: "Film bulunamadı." });
    }

    const html = await pageReq.text();

    // 1. Film Sayfası Varoluş ve İçerik Kontrolü
    const isNotFound =
      html.includes("Sayfa Bulunamadı") ||
      html.includes("BULUNAMADI!") ||
      /<title>[^<]*Sayfa Bulunamadı[^<]*<\/title>/i.test(html);

    if (isNotFound) {
      return res.status(404).json({ exists: false, error: "Film sayfası kaynak sitede bulunamadı." });
    }

    // HTML entity'leri çöz
    const decode = (s) => s
      .replace(/&#0*(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
      .replace(/&#x0*([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
      .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ").trim();

    const descMatch = html.match(/<meta property="og:description" content="([^"]+)"/);
    const desc = descMatch ? decode(descMatch[1]) : "Film açıklaması yüklenemedi.";

    // Sadece geçerli film slug'ları kabul edilir
    const isMovieSlug = (s) => !!s && /^[^\s"'<>\\]+-film-izle$/.test(s);

    // Oynatıcı / Video ID varlığı kontrolü (içerik gerçekten var mı?)
    const hasPlayer =
      /videoId\s*=\s*'[^']+'/.test(html) ||
      /data-movie-id="[^"]+"/.test(html) ||
      /data-id="[^"]+"/.test(html) ||
      html.includes("/get-source");

    const languages = [];
    const seenUrls = new Set();
    const seenNames = new Set();

    function addLanguageOption(name, url) {
      const cleanName = decode(name).replace(/\s+/g, ' ').trim();
      const normName = cleanName.toLowerCase();
      if (seenNames.has(normName) || seenUrls.has(url)) return;

      seenNames.add(normName);
      seenUrls.add(url);
      languages.push({ url, name: cleanName });
    }

    // 1. Link Tabanlı Dil Seçenekleri (<a href="...">...</a>)
    const linkRegex = /<a[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/gi;
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      const text = match[2].trim().replace(/(<([^>]+)>)/gi, "");
      const tLower = text.toLowerCase();

      // Kategori linkleri, menüler ve fragman butonlarını atla
      if (tLower.includes("filmler") || tLower.includes("fragman")) continue;

      if ((tLower.includes("dublaj") || tLower.includes("altyaz")) && tLower.length < 35) {
        let slug = match[1].split('/').filter(Boolean).pop();
        if (isMovieSlug(slug)) {
          let langCode = tLower.includes("altyaz") ? "en" : "tr";
          let displayName = tLower.includes("altyaz") ? "Türkçe Altyazılı" : "Türkçe Dublaj";
          addLanguageOption(displayName, `/api/play?id=${encodeURIComponent(slug)}&lang=${langCode}`);
        }
      }
    }

    // 2. Ajax Tabanlı Dil Butonları (data-movie-id veya data-id)
    const btnRegex = /<[^>]+data-(?:movie-id|id)="([^"]+)"[^>]*>(.*?)<\/[^>]+>/gi;
    while ((match = btnRegex.exec(html)) !== null) {
      const text = match[2].trim().replace(/(<([^>]+)>)/gi, "");
      const tLower = text.toLowerCase();

      if (tLower.includes("filmler") || tLower.includes("fragman")) continue;

      if ((tLower.includes("dublaj") || tLower.includes("altyaz")) && tLower.length < 35) {
        let langCode = tLower.includes("altyaz") ? "en" : "tr";
        let displayName = tLower.includes("altyaz") ? "Türkçe Altyazılı" : "Türkçe Dublaj";
        addLanguageOption(displayName, `/api/play?id=${encodeURIComponent(id)}&vid=${encodeURIComponent(match[1])}&lang=${langCode}`);
      }
    }

    // 3. Eğer sayfada başka dil linki bulunamadıysa ama sayfanın kendisinde video oynatıcı varsa
    if (languages.length === 0 && hasPlayer) {
      const pageTitle = (html.match(/<title>([^<]+)<\/title>/i) || ["", ""])[1].toLowerCase();
      let defaultLabel = "FİLMİ İZLE";
      let langCode = "tr";

      if (pageTitle.includes("altyaz") || id.includes("-altyazili-")) {
        defaultLabel = "Türkçe Altyazılı";
        langCode = "en";
      } else if (pageTitle.includes("dublaj") || id.includes("-turkce-dublaj-") || id.includes("-dublaj-")) {
        defaultLabel = "Türkçe Dublaj";
        langCode = "tr";
      }

      addLanguageOption(defaultLabel, `/api/play?id=${encodeURIComponent(id)}&lang=${langCode}`);
    }

    // Eğer ne video oynatıcı ne de bir oynatma linki varsa -> Film içeriği boş/yoktur
    if (languages.length === 0 && !hasPlayer) {
      return res.status(200).json({
        exists: false,
        desc,
        languages: [],
        message: "Bu film için izlenebilir video içeriği bulunamadı."
      });
    }

    res.status(200).json({
      exists: true,
      desc,
      languages
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
