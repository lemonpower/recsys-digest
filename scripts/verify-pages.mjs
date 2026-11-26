import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';

const root = resolve(process.argv[2]);
const base = '/recsys-digest/';
async function list(folder = '') {
  const entries = await readdir(join(root, folder), { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => {
    const relative = folder ? folder + '/' + entry.name : entry.name;
    return entry.isDirectory() ? list(relative) : [relative];
  }))).flat();
}
const names = new Set(await list());
const html = new Map();
for (const name of names) {
  if (name.endsWith('.html')) html.set(name, await readFile(join(root, name), 'utf8'));
}
for (const name of ['index.html', 'archive/index.html', 'assets/archive.js', 'assets/digest.css', '.nojekyll']) assert.ok(names.has(name), name);
function target(path) {
  if (!path.startsWith(base)) return null;
  const rel = decodeURIComponent(path.slice(base.length));
  if (rel.split('/').some(part => part === '..' || part === '.')) return null;
  return rel.endsWith('/') || !rel ? rel + 'index.html' : rel;
}
for (const [name, document] of html) {
  for (const [, raw] of document.matchAll(/(?:href|src|action)="([^"]+)"/gu)) {
    const value = raw.replaceAll('&amp;', '&');
    if (/^https:\/\//u.test(value)) continue;
    if (value.startsWith('#')) {
      assert.ok(document.includes('id="' + value.slice(1) + '"'), name + ' ' + value);
      continue;
    }
    const url = new URL(value, 'https://lemonpower.github.io');
    const linked = target(url.pathname);
    assert.ok(linked && names.has(linked), name + ' ' + value);
  }
}
assert.match(html.get('index.html'), /推荐系统日报/u);
assert.match(html.get('index.html'), /AI 技术日报/u);
assert.match(html.get('archive/index.html'), /id="search"/u);
const papers = [...html.keys()].filter(p => /^papers\//u.test(p));
assert.ok(papers.length > 0);
for (const p of papers) assert.match(html.get(p), /在 arXiv 阅读论文/u);
console.log(JSON.stringify({htmlPages:html.size, paperPages:papers.length, base, paths:'passed'}));

if (process.argv.includes('--serve')) {
  const mime = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'};
  http.createServer(async (req, res) => {
    const file = target(new URL(req.url,'http://127.0.0.1').pathname);
    if (!file || !names.has(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, {'content-type':mime[extname(file)] ?? 'text/plain'});
    res.end(await readFile(join(root,file)));
  }).listen(8129,'127.0.0.1',() => console.log('Local http://127.0.0.1:8129' + base));
}
