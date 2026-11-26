import { execFile } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const docs = join(root, 'docs');
const manifest = join(root, 'data', 'issues.json');
const fetcher = join(root, 'scripts', 'fetch-source.ps1');
const parser = join(root, 'scripts', 'read-article.py');
const python = process.env.RECSYS_PYTHON || 'python';
const origin = 'https://blog.recsys-frontier.com';
const base = '/recsys-digest/';
const archive = base + 'archive/';
const title = '推荐算法与 AI 技术日报';
const categories = { recsys: '推荐系统日报', ai: 'AI 技术日报' };
const safeTags = new Set('p h2 h3 ul ol li a strong b em i s code pre br hr table thead tbody tr th td'.split(' '));
const license = 'https://creativecommons.org/licenses/by-nc-sa/4.0/';
const idPattern = /^(ai|recsys):(\d{4}-\d{2}-\d{2})$/u;
const formatDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' });
const last = formatDate.format(Date.now() - 7 * 86400_000);
const first = formatDate.format(Date.now() - 30 * 86400_000);
const eligible = (id) => {
  const match = idPattern.exec(id);
  return match && match[2] >= first && match[2] <= last;
};
const key = (issue) => issue.kind + ':' + issue.date;
const relative = (issue) => 'daily/' + issue.kind + '/' + issue.date + '/';
const pathFor = (issue) => base + relative(issue);
const escape = (value) => String(value).replace(/[&<>"']/gu, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);

function editions(id) {
  const [, kind, date] = idPattern.exec(id);
  return [
    '/article/' + (kind === 'ai' ? 'ai-daily-' : 'daily-report-') + date,
    '/en/article/' + (kind === 'ai' ? 'ai-daily-en-' : 'rec-daily-en-') + date,
  ];
}

async function fetchSource(path) {
  try {
    const result = await run('pwsh', ['-NoProfile','-File',fetcher,path], { encoding: 'utf8', timeout: 22_000, maxBuffer: 8_000_000 });
    return result.stdout;
  } catch (error) {
    if (error.code === 3) return null;
    throw new Error('Source could not be checked at ' + path);
  }
}

async function inspect(id, includeContent) {
  for (const path of editions(id)) {
    const markup = await fetchSource(path);
    if (!markup) continue;
    const sourceUrl = origin + path;
    const data = await new Promise((resolve, reject) => {
      const child = execFile(python, [parser, sourceUrl, ...(includeContent ? ['--content'] : [])],
        { encoding: 'utf8', timeout: 18_000, maxBuffer: 2_000_000 }, (error, stdout) => {
          if (error) { reject(new Error('Article extraction failed for ' + id)); return; }
          try { resolve(JSON.parse(stdout)); } catch (issue) { reject(issue); }
        });
      child.stdin.on('error', reject);
      child.stdin.end(markup, 'utf8');
    });
    if (data.status === 'public') return { ...data, sourceUrl };
  }
  return { status: 'not-public' };
}

async function batch(items, action) {
  const results = [];
  for (let index = 0; index < items.length; index += 4) results.push(...await Promise.all(items.slice(index, index + 4).map(action)));
  return results;
}

async function discover(archiveEntries) {
  const surfaces = await Promise.allSettled(['/en/archive', '/archive', '/'].map(fetchSource));
  const found = new Set();
  for (const surface of surfaces) {
    if (surface.status !== 'fulfilled' || !surface.value) continue;
    const publicHtml = surface.value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/giu, '');
    for (const [, slug, date] of publicHtml.matchAll(/href=["'](?:https:\/\/blog\.recsys-frontier\.com)?\/(?:en\/)?article\/(ai-daily(?:-en)?|rec-daily-en|daily-report)-(\d{4}-\d{2}-\d{2})["']/gu)) {
      const id = (slug.startsWith('ai-') ? 'ai' : 'recsys') + ':' + date;
      if (eligible(id)) found.add(id);
    }
  }
  if (!found.size) throw new Error('Could not verify the public archive index.');
  const known = new Set(archiveEntries.map(key));
  return {
    first, last, issues: [...known],
    newIssues: [...found].filter((id) => !known.has(id)).sort(),
    importKeys: archiveEntries.filter((e) => !e.reprint && eligible(key(e))).map(key),
  };
}

function shell(pageTitle, body, script = '') {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(pageTitle)}</title>
<link rel="stylesheet" href="${base}assets/digest.css"></head><body>
<header><nav class="wrap nav" aria-label="主导航"><a class="brand" href="${base}">${title}</a><div class="navlinks"><a href="${base}">首页</a><a href="${archive}">归档</a></div></nav></header>
<main class="wrap">${body}</main>
<footer><div class="wrap">日报来源为 <a href="${origin}">Recsys Frontier（九老师）</a>。转载正文的署名和许可见各篇。</div></footer>${script}</body></html>
`;
}

function cards(entries) {
  return entries.map((e) => {
    const keywords = [e.title, e.intro, e.date, categories[e.kind], ...e.tags, ...(e.paperTitles ?? [])].join(' ');
    return `<article class="issue" data-kind="${e.kind}" data-search="${escape(keywords)}">
<h2><a href="${pathFor(e)}">${escape(e.title)}</a></h2>
<p class="meta">${categories[e.kind]} · <time datetime="${e.date}">${e.date}</time> · ${e.reprint ? '中文原文' : '中文导读'}</p>
<p>${escape(e.intro)}</p><div class="tags">${e.tags.map(tag => `<a class="tag" href="${archive}?q=${encodeURIComponent(tag)}">${escape(tag)}</a>`).join('')}</div>
<div class="issue-actions"><a class="button" href="${pathFor(e)}">阅读日报</a></div></article>`;
  }).join('\n');
}

function renderContent(content) {
  const toc = [];
  const label = (nodes) => nodes.map(n => typeof n === 'string' ? n : label(n[1])).join('');
  const render = (node) => {
    if (typeof node === 'string') return escape(node);
    const [tag, children, href] = node;
    if (!safeTags.has(tag)) return '';
    if (tag === 'br' || tag === 'hr') return '<' + tag + '>';
    const inner = children.map(render).join('');
    if (tag === 'a') {
      const url = URL.parse(href);
      return url?.protocol === 'https:' && !url.username && !url.password
        ? `<a href="${escape(href)}" rel="noopener noreferrer">${inner}</a>` : inner;
    }
    if (tag === 'h2') {
      const anchor = 'section-' + (toc.length + 1);
      toc.push([anchor, label(children).trim()]);
      return `<h2 id="${anchor}">${inner}</h2>`;
    }
    return '<' + tag + '>' + inner + '</' + tag + '>';
  };
  const reading = content.map(render).join('');
  const links = toc.filter(([, text]) => text).map(([id, text]) => `<li><a href="#${id}">${escape(text)}</a></li>`).join('');
  return (links ? `<details class="toc"><summary>目录</summary><ul>${links}</ul></details>` : '') + reading;
}

function detail(e, content, extra) {
  const credit = content
    ? `<p>作者：九老师 · Recsys Frontier。<a href="${escape(e.sourceUrl)}">原始中文版</a> · <a href="${license}" rel="license">CC BY-NC-SA 4.0</a>。本站调整排版，转载正文适用同一许可。</p>`
    : `<p>此页为中文导读。<a href="${escape(e.sourceUrl)}">查看原站日报</a></p>`;
  return shell(e.title + ' · ' + categories[e.kind], `<article class="article"><a class="back" href="${archive}">返回日报归档</a>
<p class="meta">${categories[e.kind]} · <time datetime="${e.date}">${e.date}</time> · ${content ? '中文原文' : '中文导读'}</p>
<h1>${escape(e.title)}</h1><p class="lead">${escape(e.intro)}</p>
${content ? `<div class="reading">${renderContent(content)}</div>` : ''}
<aside class="attribution" aria-label="来源及许可">${credit}</aside>${extra}</article>`);
}

async function write(path, html) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, html, 'utf8');
}

async function rebuild(entries) {
  const issueCards = cards(entries);
  await Promise.all([
    write(join(docs, 'index.html'), shell(title, `<div class="toolbar"><div><h1>${title}</h1><p class="meta">按日期阅读两类日报、中文导读和已获许可的中文版。</p></div><a class="button" href="${archive}">查看归档</a></div>${cards(entries.slice(0,8))}`)),
    write(join(docs, 'archive', 'index.html'), shell('归档 · ' + title, `<div class="toolbar"><div><h1>日报归档</h1><p class="archive-count" id="result-count">${entries.length} 篇日报</p></div>
<form action="${archive}" role="search"><label class="sr" for="kind">类别</label><select id="kind" name="kind"><option value="">全部类别</option><option value="recsys">推荐系统</option><option value="ai">AI 技术</option></select><label class="sr" for="search">搜索日报</label><input id="search" type="search" name="q" placeholder="标题、主题或日期"><button>搜索</button></form></div><p id="empty" class="empty" hidden>没有匹配的日报。</p>${issueCards}`, `<script src="${base}assets/archive.js" defer></script>`)),
  ]);
}

async function apply(current, paths) {
  const entries = new Map(current.map(e => [key(e), e]));
  const candidates = new Set();
  const drafts = new Map();
  for (const file of paths) {
    const data = JSON.parse(await readFile(resolve(file), 'utf8'));
    for (const id of data.importKeys ?? []) if (eligible(id)) candidates.add(id);
    for (const issue of data.entries ?? []) {
      const id = key(issue);
      if (!eligible(id)) continue;
      if (typeof issue.title !== 'string' || !issue.title.trim() || issue.title.length > 100
          || typeof issue.intro !== 'string' || !issue.intro.trim() || issue.intro.length > 500
          || !Array.isArray(issue.tags) || issue.tags.length < 1 || issue.tags.length > 3
          || !issue.tags.every(t => typeof t === 'string' && t.trim() && t.length < 25)) {
        throw new Error('Invalid title, introduction or tags for ' + id);
      }
      drafts.set(id, { kind: issue.kind, date: issue.date, title: issue.title, intro: issue.intro, tags: issue.tags });
      candidates.add(id);
    }
  }
  const available = [...candidates].filter((id) => !entries.get(id)?.reprint && (drafts.has(id) || entries.has(id)));
  const inspected = await batch(available, async id => [id, await inspect(id, true)]);
  const added = [], upgraded = [], deferred = [];
  for (const [id, checked] of inspected) {
    const previous = entries.get(id);
    if (checked.status !== 'public' || (previous && !checked.content?.length)) { deferred.push(id); continue; }
    const issue = { ...(previous ?? drafts.get(id)), sourceUrl: checked.sourceUrl, reprint: Boolean(checked.content?.length) };
    const dest = join(docs, relative(issue), 'index.html');
    const existing = previous ? await readFile(dest, 'utf8') : '';
    const extra = existing.match(/<section class="reading paper-list">[\s\S]*?<\/section>/u)?.[0] ?? '';
    const page = detail(issue, issue.reprint ? checked.content : null, extra);
    await write(dest, page);
    if (issue.kind === 'recsys') {
      const alias = join(docs, 'daily', issue.date, 'index.html');
      if (await access(alias).then(() => true, () => false)) await write(alias, page);
    }
    entries.set(id, issue);
    (previous ? upgraded : added).push(id);
  }
  if (added.length || upgraded.length) {
    const ordered = [...entries.values()].sort((a,b) => b.date.localeCompare(a.date) || b.kind.localeCompare(a.kind));
    await rebuild(ordered);
    await write(manifest, JSON.stringify(ordered, null, 2) + '\n');
  }
  console.log(JSON.stringify({ added, upgraded, deferred, total: entries.size }));
}

const entries = JSON.parse(await readFile(manifest, 'utf8'));
const [command, ...args] = process.argv.slice(2);
if (command === '--discover') console.log(JSON.stringify(await discover(entries)));
else if (command === '--inspect') {
  const rows = await batch([...new Set(args)].filter(eligible), async id => ({ id, ...await inspect(id, false) }));
  for (const row of rows) console.log(JSON.stringify(row));
} else if (command === '--apply' && args.length) await apply(entries, args);
else throw new Error('Use --discover, --inspect <kind:date ...>, or --apply <draft.json ...>.');
