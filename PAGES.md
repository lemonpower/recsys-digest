# 技术日报网站

GitHub Pages 发布目录是 `main` 分支的 `/docs`。生成的页面在 `/recsys-digest/` 子路径下运行。

- `docs/index.html` 是首页。
- `docs/archive/index.html` 是可搜索的归档。类别和搜索词可通过查询参数共享。
- `docs/daily/` 包含两类日报。
- `docs/papers/` 对应已整理的论文详情，包含 arXiv 链接和收录日报。

## 每日更新

现有 Codex 本机日程每天北京时间 9:00 检查 Recsys Frontier，将合格日报的页面和索引提交到 `main`，由 GitHub Pages 发布。Git 使用本机 Credential Manager 登录的 GitHub 账号。

本机生成流程使用 Node.js、PowerShell 7 和 Python 3。可用 `RECSYS_PYTHON` 指定 Python 解释器。

1. 执行 `node scripts/update-digests.mjs --discover` 查看近 30 天的新期数和待补正文期数。日期须至少早于北京时间当前日期七天。
2. 执行 `node scripts/update-digests.mjs --inspect ai:YYYY-MM-DD recsys:YYYY-MM-DD` 核实公开正文。为新增的期数整理简短中文导读。
3. 将 `{entries, importKeys}` 保存到工作目录。每条 `entries` 记录包含 `kind`、`date`、`title`、`intro`、`tags`。已有导读可通过 `importKeys` 中的 `kind:date` 重查中文版。
4. 执行 `node scripts/update-digests.mjs --apply 路径` 生成页面，然后执行 `node scripts/verify-pages.mjs docs` 核对站内链接。将日报、归档和索引一起提交。

脚本只从普通公开文章页面读取内容。已明确标注 CC BY-NC-SA 4.0 的公开中文版可以在详情页重新排版，页面保留署名、来源和同一许可。其它已核实全文公开的期数在站内提供中文导读和来源链接。
