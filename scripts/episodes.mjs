// Atualiza content/episodes.json com os episódios mais recentes, lidos dos RSS:
//   node scripts/episodes.mjs
// O build só lê esse arquivo (não acessa a rede). Se um feed falhar, a lista
// anterior daquele podcast é mantida e o script termina com erro.
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'content', 'episodes.json');
const LIMIT = 5;

const FEEDS = {
  // Bom dia Tech: título vem como "12/11/2026 – Assunto…"; o número está em <itunes:episode>
  bdt: {
    url: 'https://anchor.fm/s/11210f64/podcast/rss',
    pick: () => true,
    map: it => ({
      n: it['itunes:episode'] ? '#' + it['itunes:episode'] : '',
      title: it.title.replace(/^\d{2}\/\d{2}\/\d{4}\s*[–—-]\s*/, ''),
    }),
  },
  // Área de Transferência: título vem como "504: Nome"; só entram episódios com o Arthur
  adt: {
    url: 'https://gigahertz.fm/podcasts/adt/feed.rss',
    pick: it => /Arthur\s+Givigir/i.test(it.raw),
    map: it => {
      const m = it.title.match(/^(\d+):\s*(.+)$/);
      return m ? { n: '#' + m[1], title: m[2] } : { n: '', title: it.title };
    },
  },
};

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const text = s => s
  .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1')
  .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? m)
  .trim();

function field(raw, tag) {
  const m = raw.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  return m ? text(m[1].trim()) : '';
}

// "00:07:01" ou "421" (segundos) → minutos
function minutes(d) {
  if (!d) return null;
  const p = d.split(':').map(Number);
  if (p.some(Number.isNaN)) return null;
  const s = p.length === 1 ? p[0] : p.reduce((a, v) => a * 60 + v, 0);
  return Math.max(1, Math.round(s / 60));
}

async function read(feed) {
  const res = await fetch(feed.url, { signal: AbortSignal.timeout(30000), headers: { 'user-agent': 'site-build' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  const out = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const raw = m[1];
    const it = { raw, title: field(raw, 'title'), 'itunes:episode': field(raw, 'itunes:episode') };
    if (!feed.pick(it)) continue;
    const url = field(raw, 'link');
    const date = new Date(field(raw, 'pubDate'));
    if (!it.title || !/^https:\/\//.test(url) || Number.isNaN(+date)) continue;
    out.push({ ...feed.map(it), url, date: date.toISOString(), minutes: minutes(field(raw, 'itunes:duration')) });
    if (out.length === LIMIT) break;
  }
  if (!out.length) throw new Error('nenhum episódio encontrado');
  return out;
}

const data = JSON.parse(await readFile(OUT, 'utf8').catch(() => '{}'));
let failed = false;
for (const [key, feed] of Object.entries(FEEDS)) {
  try {
    data[key] = await read(feed);
    console.log(`${key}: ${data[key].length} episódios, o mais recente de ${data[key][0].date.slice(0, 10)}`);
  } catch (e) {
    failed = true;
    console.error(`${key}: falhou (${e.message}); mantendo a lista anterior`);
  }
}
data.updated = new Date().toISOString();
await writeFile(OUT, JSON.stringify(data, null, 2) + '\n');
if (failed) process.exit(1);
