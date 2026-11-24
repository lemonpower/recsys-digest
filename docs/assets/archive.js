const params = new URLSearchParams(location.search);
const kind = params.get('kind') || '';
const query = params.get('q') || '';
const normalize = (value) => value.normalize('NFKC').toLowerCase();
document.querySelector('#search').value = query;
document.querySelector('#kind').value = ['ai','recsys'].includes(kind) ? kind : '';
let count = 0;
for (const article of document.querySelectorAll('[data-search]')) {
  article.hidden = (Boolean(document.querySelector('#kind').value) && article.dataset.kind !== kind)
    || !normalize(article.dataset.search).includes(normalize(query.trim()));
  if (!article.hidden) count += 1;
}
document.querySelector('#result-count').textContent = count + ' 篇日报';
document.querySelector('#empty').hidden = count !== 0;
