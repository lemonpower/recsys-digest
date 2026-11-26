import json
import re
import sys
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

VOID = set("area base br col embed hr img input link meta param source track wbr".split())
DROP = set("script style template noscript iframe svg img video audio figure button form nav".split())
KEEP = set("p h2 h3 h4 h5 h6 ul ol li a strong b em i s code pre br hr table thead tbody tr th td div section".split())
GATE = re.compile(r"去\s*Substack\s*阅读全文|订阅期内所有日报周报全文|订阅后(?:可)?阅读(?:完整)?全文|订阅\s*RecsysFrontier[，,]\s*在\s*Substack\s*阅读本期全文|会员专享|continue reading on substack", re.I)
LICENSE = re.compile(r"(?:本文采用|许可协议)[^。\n]{0,75}CC BY-NC-SA 4\.0|CC BY-NC-SA 4\.0[^。\n]{0,35}(?:许可协议|转载请)", re.I)


class Tree(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = {"tag": "", "attrs": {}, "children": []}
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        node = {"tag": tag, "attrs": dict(attrs), "children": []}
        self.stack[-1]["children"].append(node)
        if tag not in VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index]["tag"] == tag:
                del self.stack[index:]
                break

    def handle_data(self, text):
        self.stack[-1]["children"].append(text)


def nodes(node):
    if isinstance(node, str) or is_hidden(node):
        return
    yield node
    if node["tag"] not in DROP:
        for child in node["children"]:
            yield from nodes(child)


def is_hidden(node):
    attrs = node["attrs"]
    return ("hidden" in attrs or attrs.get("aria-hidden") == "true"
            or bool(re.search(r"(?:display\s*:\s*none|visibility\s*:\s*hidden)", attrs.get("style") or "", re.I))
            or "hidden" in (attrs.get("class") or "").split())


def visible(node):
    if isinstance(node, str):
        return node
    if node["tag"] in DROP or is_hidden(node):
        return ""
    return "".join(visible(child) for child in node["children"])


def compact(node, source):
    if isinstance(node, str):
        return [node]
    tag = node["tag"]
    if tag in DROP or tag == "blockquote" or is_hidden(node):
        return []
    children = [part for child in node["children"] for part in compact(child, source)]
    if tag not in KEEP:
        return children
    if not children and tag not in {"hr", "br"}:
        return []
    attrs = node["attrs"]
    if tag == "a":
        raw = (attrs.get("href") or "").strip()
        if not raw or raw.startswith("#"):
            return children
        href = urljoin(source, raw)
        parsed = urlsplit(href)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            return children
        return [["a", children, href]]
    if tag in {"div", "section"}:
        classes = (attrs.get("class") or "").split()
        if any(c in classes for c in ("notion-text", "notion-callout-text")):
            tag = "p"
        else:
            return children
    if tag in {"h3", "h4", "h5", "h6"}:
        tag = "h2" if "notion-h2" in (attrs.get("class") or "").split() else "h3"
    return [[tag, children]]


def collect(source, markup, include_content=False):
    parser = Tree()
    parser.feed(markup)
    layout = next((n for n in nodes(parser.root) if n["attrs"].get("id") == "container-inner"), None)
    if layout is None:
        return {"status": "no-public-article"}
    article = next((n for n in nodes(layout)
                    if n["tag"] == "article" and n["attrs"].get("id") == "article-wrapper"), None)
    if article is None:
        return {"status": "no-public-article"}
    layout_text = visible(layout)
    if GATE.search(layout_text) or re.search(r"read (?:the )?(?:full|complete) (?:report|article|post) on Substack|subscribe (?:to|on) Substack to (?:read|unlock)|继续阅读请订阅", layout_text, re.I):
        return {"status": "preview"}
    path = urlsplit(source).path
    title = next((visible(n) for n in nodes(parser.root) if n["tag"] == "title"), "")
    if path[-10:] not in title:
        return {"status": "date-mismatch"}
    page = next((n for n in nodes(article)
                 if n["tag"] == "main" and "notion-page" in (n["attrs"].get("class") or "").split()), None)
    if page is None:
        return {"status": "no-article-body"}
    body = next((n for n in nodes(page)
                 if "notion-page-content" in (n["attrs"].get("class") or "").split()), page)
    text = visible(body)
    parts = list(nodes(body))
    normalize = lambda s: " ".join(s.split())
    headings = [normalize(visible(n)) for n in parts if n["tag"] in {"h2", "h3", "h4"}]
    paragraphs = [normalize(visible(n)) for n in parts
                  if n["tag"] == "p" or "notion-text" in (n["attrs"].get("class") or "").split()]
    items = [normalize(visible(n)) for n in parts if n["tag"] == "li"]
    if len(text) < 550 or len(headings) < 3 or len(paragraphs) + len(items) < 5:
        return {"status": "unverified-body"}
    notes = list(dict.fromkeys(p for p in paragraphs[:4] + items[:4] if len(p) > 35))
    result = {"status": "public", "notes": [p[:160] for p in notes[:4]]}
    if include_content and path.startswith("/article/") and len(re.findall(r"[\u4e00-\u9fff]", text)) >= 300:
        licensed = any(LICENSE.search(text) and "九老师" in text and path in text
                       for n in nodes(layout) if n["tag"] == "section"
                       for text in [visible(n)] if len(text) < 600)
        if licensed:
            result["content"] = [part for child in body["children"] for part in compact(child, source)]
    return result


sys.stdout.reconfigure(encoding="utf-8")
raw = sys.stdin.buffer.read().decode("utf-8")
print(json.dumps(collect(sys.argv[1], raw, "--content" in sys.argv[2:]), ensure_ascii=False, separators=(",", ":")))
