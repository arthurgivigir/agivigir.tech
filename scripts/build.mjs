// Gera o site estático em dist/ sem dependências:
//   node scripts/build.mjs           → dist/index.html (PT), dist/en/index.html (EN) + public/
//   node scripts/build.mjs --serve   → build + servidor local com rebuild ao salvar
import { readFile, writeFile, mkdir, rm, readdir, copyFile, stat } from 'node:fs/promises';
import { watch, createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { join, dirname, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const PUBLIC = join(ROOT, 'public');
const SITE = 'https://agivigir.tech/';

const PAGES = [
  { file: 'site.pt.json', out: 'index.html', base: '', path: '', isPt: true, altLocale: 'en_US' },
  { file: 'site.en.json', out: 'en/index.html', base: '../', path: 'en/', isPt: false, altLocale: 'pt_BR' },
];

// ───────── Mini-template (subconjunto de Mustache) ─────────
// {{a.b}} texto escapado · {{{a}}} bruto · {{#a}}…{{/a}} lista/condição · {{^a}}…{{/a}} inverso
// {{.}} item atual · {{@a}} busca na raiz · {{>nome}} parcial definida em <!--partial:nome-->…<!--/partial:nome-->
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = v => String(v).replace(/[&<>"']/g, c => ESC[c]);
const TAG = /\{\{(\{)?\s*([#^/>]?)\s*([@\w.]+)\s*\}?\}\}/g;

function parse(src) {
  const root = { children: [] }, stack = [root];
  let last = 0;
  for (const m of src.matchAll(TAG)) {
    const top = stack[stack.length - 1];
    if (m.index > last) top.children.push(src.slice(last, m.index));
    last = m.index + m[0].length;
    const [, raw, kind, name] = m;
    if (kind === '#' || kind === '^') {
      const node = { kind, name, children: [] };
      top.children.push(node); stack.push(node);
    } else if (kind === '/') {
      const open = stack.pop();
      if (!open?.name || open.name !== name) throw new Error(`template: {{/${name}}} fecha ${open?.name ?? 'nada'}`);
    } else top.children.push({ kind: kind || (raw ? 'raw' : 'var'), name });
  }
  if (stack.length !== 1) throw new Error(`template: {{#${stack.pop().name}}} sem fechamento`);
  root.children.push(src.slice(last));
  return root.children;
}

function lookup(name, ctx, rootCtx) {
  if (name === '.') return ctx;
  const [scope, path] = name.startsWith('@') ? [rootCtx, name.slice(1)] : [ctx, name];
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), scope);
}

function render(nodes, ctx, rootCtx, partials) {
  let out = '';
  for (const n of nodes) {
    if (typeof n === 'string') { out += n; continue; }
    if (n.kind === '>') {
      if (!(n.name in partials)) throw new Error(`template: parcial "${n.name}" não existe`);
      out += render(partials[n.name], ctx, rootCtx, partials);
      continue;
    }
    const v = lookup(n.name, ctx, rootCtx);
    const empty = v == null || v === false || v === '' || (Array.isArray(v) && !v.length);
    if (n.kind === 'var' || n.kind === 'raw') {
      if (v === undefined || typeof v === 'object') throw new Error(`template: {{${n.name}}} sem valor de texto`);
      out += n.kind === 'raw' ? String(v) : escape(v);
    } else if (n.kind === '^') {
      if (empty) out += render(n.children, ctx, rootCtx, partials);
    } else if (!empty) {
      if (Array.isArray(v)) for (const item of v) out += render(n.children, item, rootCtx, partials);
      else out += render(n.children, typeof v === 'object' ? v : ctx, rootCtx, partials);
    }
  }
  return out;
}

function compile(src) {
  const partials = {};
  const body = src.replace(/<!--partial:(\w+)-->\n?([\s\S]*?)<!--\/partial:\1-->\n?/g, (_, name, inner) => {
    partials[name] = parse(inner.trimEnd());
    return '';
  });
  const tree = parse(body);
  return data => render(tree, data, data, partials);
}

// ───────── Conteúdo ─────────
// Só aceita links https: e mailto: vindos do JSON.
function checkUrls(node, where = 'content') {
  if (Array.isArray(node)) return node.forEach((v, i) => checkUrls(v, `${where}[${i}]`));
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (/^(url|moreUrl)$/.test(k) && !/^(https:\/\/|mailto:)/.test(v)) throw new Error(`${where}.${k}: link inválido "${v}"`);
      checkUrls(v, `${where}.${k}`);
    }
  }
}

function prepare(c, page, episodes) {
  const status = c.ui.status;
  const withStatus = it => (it.status ? { ...it, statusLabel: status[it.status] ?? fail(`status desconhecido: ${it.status}`) } : it);
  const linkable = it => ({ ...withStatus(it), tag: it.url ? 'a' : 'div' });
  const rows = group => ({ ...group, items: group.items.map(linkable) });

  const d = JSON.parse(JSON.stringify(c));
  d.pod.shows.items = d.pod.shows.items.map(withStatus);
  // episódios vêm de content/episodes.json (gerado por scripts/episodes.mjs a partir dos RSS)
  const date = new Intl.DateTimeFormat(page.isPt ? 'pt-BR' : 'en-US', {
    ...(page.isPt ? { day: '2-digit', month: '2-digit' } : { day: 'numeric', month: 'short' }),
    year: 'numeric', timeZone: 'America/Sao_Paulo',
  });
  const dur = m => (m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`);
  const eps = (key, group) => {
    const list = episodes[key] ?? [];
    if (!list.length) fail(`content/episodes.json sem episódios de "${key}": rode npm run episodes`);
    return rows({ ...group, items: list.map(e => ({
      n: e.n, title: e.title, url: e.url,
      sub: date.format(new Date(e.date)) + (e.minutes ? ` · ${dur(e.minutes)}` : ''),
    })) });
  };
  d.pod.latest = eps('bdt', d.pod.latest);
  d.pod.guest = eps('adt', d.pod.guest);
  for (const k of ['web', 'oss', 'jobs', 'edu', 'links']) d.dev[k] = rows(d.dev[k]);
  d.dev.apps.items = d.dev.apps.items.map(linkable);

  const pageUrl = SITE + page.path;
  const person = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: c.name,
    url: SITE,
    image: SITE + 'face.webp',
    jobTitle: c.person.jobTitle,
    description: c.head.description,
    email: 'mailto:' + c.email,
    address: { '@type': 'PostalAddress', addressLocality: c.person.city, addressCountry: c.person.country },
    sameAs: c.person.sameAs,
  };
  return {
    ...d,
    site: SITE,
    pageUrl,
    base: page.base,
    isPt: page.isPt,
    altLocale: page.altLocale,
    hrefPt: page.isPt ? './' : '../',
    hrefEn: page.isPt ? 'en/' : './',
    year: String(new Date().getFullYear()),
    jsonld: JSON.stringify(person).replace(/</g, '\\u003c'),
  };
}

function fail(msg) { throw new Error(msg); }

// CSS: tira comentários e espaços sobrando (conservador; não mexe em calc()).
const minCss = css => css
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ')
  .replace(/\s*([{};])\s*/g, '$1')
  .replace(/;}/g, '}')
  .trim();

// JS: só remove linhas de comentário e indentação.
const minJs = js => js
  .split('\n')
  .map(l => l.trim())
  .filter(l => l && !l.startsWith('//'))
  .join('\n');

async function copyDir(from, to) {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const a = join(from, entry.name), b = join(to, entry.name);
    if (entry.isDirectory()) await copyDir(a, b);
    else await copyFile(a, b);
  }
}

async function build() {
  const t0 = Date.now();
  const [tpl, css, js] = await Promise.all(
    ['src/template.html', 'src/styles.css', 'src/app.js'].map(f => readFile(join(ROOT, f), 'utf8')),
  );
  if (/<\/style/i.test(css)) fail('styles.css não pode conter </style');
  if (/<\/script/i.test(js)) fail('app.js não pode conter </script');
  const page = compile(tpl);
  const assets = { css: minCss(css), js: minJs(js) };

  await rm(DIST, { recursive: true, force: true });
  await copyDir(PUBLIC, DIST);

  for (const p of PAGES) {
    const content = JSON.parse(await readFile(join(ROOT, 'content', p.file), 'utf8'));
    const episodes = JSON.parse(await readFile(join(ROOT, 'content', 'episodes.json'), 'utf8'));
    checkUrls(content, p.file);
    const html = page({ ...prepare(content, p, episodes), ...assets })
      .replace(/<!--[\s\S]*?-->\n?/g, '')
      .replace(/^[ \t]+$/gm, '')
      .replace(/\n{3,}/g, '\n\n');

    // toda imagem local referenciada precisa existir em public/
    for (const [, src] of html.matchAll(/(?:src|href)="(?:\.\.\/)?([\w.-]+\.(?:webp|png|svg|jpg))"/g)) {
      await stat(join(PUBLIC, src)).catch(() => fail(`${p.out}: arquivo ausente em public/: ${src}`));
    }

    const out = join(DIST, p.out);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, html);
  }
  console.log(`build ok em ${Date.now() - t0} ms → ${PAGES.map(p => 'dist/' + p.out).join(', ')}`);
}

// ───────── Servidor local (npm run dev) ─────────
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
};

function serve(port) {
  createServer(async (req, res) => {
    let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    let file = join(DIST, path);
    if (!file.startsWith(DIST + sep) && file !== DIST) { res.writeHead(403).end(); return; }
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      await stat(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      createReadStream(file).pipe(res);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('404');
    }
  }).listen(port, () => console.log(`servindo dist/ em http://localhost:${port}/`));

  let timer;
  for (const dir of ['content', 'src', 'public']) {
    watch(join(ROOT, dir), { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => build().catch(e => console.error(e.message)), 80);
    });
  }
}

await build();
if (process.argv.includes('--serve')) serve(Number(process.env.PORT) || 8080);
