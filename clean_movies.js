const fs = require('fs');
const path = require('path');

const jsonPath = path.join(__dirname, 'movies.json');
const raw = fs.readFileSync(jsonPath, 'utf8');
const list = JSON.parse(raw);

console.log('Toplam film (önce):', list.length);

function isValidId(id) {
    if (!id || typeof id !== 'string') return false;
    if (!id.endsWith('-film-izle')) return false;
    if (/[\s"'<>\\\\]/.test(id)) return false;
    if (id.includes('/')) return false;
    if (['turkce-dublaj-hd-film-izle', 'turkce-altyazili-hd-filmler-izle', '4k-film-izle'].includes(id)) return false;
    return true;
}

function isValidMovie(m) {
    if (!m || !isValidId(m.id)) return false;
    if (!m.image || !m.image.startsWith('http') || m.image.includes('/poster/0/')) return false;
    if (!m.title || m.title.trim() === '' || m.title.includes('İzlemek istediğiniz')) return false;
    return true;
}

const cleaned = list.filter(isValidMovie);
console.log('Toplam film (sonra):', cleaned.length);
console.log('Temizlenen sahte/boş kayıt sayısı:', list.length - cleaned.length);

fs.writeFileSync(jsonPath, JSON.stringify(cleaned, null, 2), 'utf8');
