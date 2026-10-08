// Vercel kendi /api uçlarını kullanır; GitHub Pages statik olduğu için Worker gerekir.
const onVercel = window.location.hostname.toLowerCase().endsWith('.vercel.app');
window.FILM_API_BASE = onVercel ? '' : 'https://inadina-tv-player-api.burhantasci72.workers.dev';
