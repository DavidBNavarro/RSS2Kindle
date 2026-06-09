# Link Reinjection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make inline hyperlinks clickable on Kindle by reinjecting `<a>` tags from the original HTML into trafilatura's extracted output.

**Architecture:** Add `_reinject_links()` that extracts `(text, href)` pairs from the article content before trafilatura, then matches and wraps the corresponding text in trafilatura's output. Gated by the existing `keep_links` toggle — when True, reinject; when False, strip any survivors.

**Tech Stack:** BeautifulSoup for HTML parsing/manipulation, `urllib.parse.urljoin` for relative URL resolution, `_find_article_image_container` for scoping to article body.

---

### Task 1: Add `_reinject_links()` function

**Files:**
- Modify: `server.py` — insert after line 1062 (after `_reinject_images`)

- [ ] **Step 1: Write `_reinject_links()`**

Insert this function at `server.py:1063` (after `_reinject_images` returns):

```python
def _reinject_links(extracted_html: str, original_html: str, url: str) -> str:
    from bs4 import BeautifulSoup

    orig_soup = BeautifulSoup(original_html, "html.parser")
    container, _ = _find_article_image_container(orig_soup)
    if not container:
        return extracted_html

    link_map: list[tuple[str, str]] = []
    seen: set[str] = set()
    for a in container.find_all("a"):
        href = a.get("href", "").strip()
        if not href or href.startswith(("#", "javascript:")):
            continue
        text = a.get_text(strip=True)
        if not text or len(text) < 3:
            continue
        resolved = urljoin(url, href)
        normalized = " ".join(text.split())
        if normalized not in seen:
            seen.add(normalized)
            link_map.append((normalized, resolved))

    if not link_map:
        return extracted_html

    link_map.sort(key=lambda x: -len(x[0]))

    ext_soup = BeautifulSoup(extracted_html, "html.parser")

    for link_text, link_url in link_map:
        for elem in ext_soup.find_all(["p", "li", "blockquote", "figcaption"]):
            if elem.find("a"):
                continue
            for text_node in list(elem.find_all(string=True)):
                if link_text not in str(text_node):
                    continue
                idx = str(text_node).index(link_text)
                before = str(text_node)[:idx]
                after = str(text_node)[idx + len(link_text):]
                a_tag = ext_soup.new_tag("a", href=link_url)
                a_tag.string = link_text
                text_node.replace_with(a_tag)
                if after:
                    a_tag.insert_after(after)
                if before:
                    a_tag.insert_before(before)
                break
            else:
                continue
            break

    return str(ext_soup)
```

- [ ] **Step 2: Verify it parses**

Run: `python3 -c "import server; print('ok')"`

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add server.py
git commit -m "feat: add _reinject_links function for clickable hyperlinks"
```

---

### Task 2: Swap toggle logic in `_html_to_article_epub()`

**Files:**
- Modify: `server.py:1447-1448`

- [ ] **Step 1: Replace the dead keep_links code**

Current:
```python
    if not keep_links:
        content_html = re.sub(r'<a\b[^>]*>(.*?)</a>', r'\1', content_html, flags=re.DOTALL)
```

Replace with:
```python
    if keep_links:
        content_html = _reinject_links(content_html, cleaned_html, url)
    else:
        content_html = re.sub(r'<a\b[^>]*>(.*?)</a>', r'\1', content_html, flags=re.DOTALL)
```

- [ ] **Step 2: Commit**

```bash
git add server.py
git commit -m "feat: activate link reinjection in article pipeline"
```

---

### Task 3: Add tests for link reinjection

**Files:**
- Modify: `tests/test_toggles.py` — after line 89

- [ ] **Step 1: Add test for keep_links=True restoring links**

Insert after line 89 (`test_article_keep_links_false_preserves_text`). Uses the existing `SAMPLE_ARTICLE_HTML` which already has `<a href="https://example.com">a link</a>`:

```python
def test_reinject_links_restores_matching_text(tmp_path, monkeypatch):
    """When keep_links=True, <a href> from original HTML appears in EPUB body."""
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import server

    monkeypatch.setattr(server, "WORK_DIR", tmp_path)
    monkeypatch.setattr(server, "_reinject_images", lambda html, orig, url: html)
    monkeypatch.setattr(server, "_fetch_and_embed_images", lambda html, book, url="": html)

    epub_path = server._html_to_article_epub(
        SAMPLE_URL, SAMPLE_ARTICLE_HTML, keep_links=True
    )

    with zipfile.ZipFile(epub_path) as zf:
        content_files = [n for n in zf.namelist()
                         if n.endswith(".xhtml") and "nav" not in n and "details" not in n]
        for fname in content_files:
            content = zf.read(fname).decode("utf-8", errors="replace")
            if "a link" in content:
                assert '<a href="https://example.com">' in content, \
                    f"Link not restored in {fname}"
                return
    assert False, "Never found content with link text"
```

- [ ] **Step 2: Add test for relative URL resolution**

After the test from step 1:

```python
def test_reinject_links_resolves_relative_urls(tmp_path, monkeypatch):
    """Relative hrefs are resolved to absolute URLs when reinjecting."""
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import server

    monkeypatch.setattr(server, "WORK_DIR", tmp_path)
    monkeypatch.setattr(server, "_reinject_images", lambda html, orig, url: html)
    monkeypatch.setattr(server, "_fetch_and_embed_images", lambda html, book, url="": html)

    html = """
<html><head><title>Test Article</title></head><body>
<article>
<h1>Test Article</h1>
<p>See <a href="/relative/page">this relative link</a> for more details.
The article covers various topics in software engineering and technology.
We need enough text so trafilatura processes this as a real article.
Machine learning has transformed many fields including computer vision.
Deep neural networks can now generate realistic images from text descriptions.
Transfer learning allows models to be fine-tuned with minimal labeled data.
Natural language processing has seen dramatic improvements in recent years.
Modern web applications rely on complex stacks of distributed technologies.
Container orchestration simplifies deployment across cloud infrastructure.
Open source software powers a significant fraction of internet infrastructure.
</p>
</article>
</body></html>
"""

    epub_path = server._html_to_article_epub(
        "https://example.com/article", html, keep_links=True
    )

    with zipfile.ZipFile(epub_path) as zf:
        content_files = [n for n in zf.namelist()
                         if n.endswith(".xhtml") and "nav" not in n and "details" not in n]
        for fname in content_files:
            content = zf.read(fname).decode("utf-8", errors="replace")
            if "this relative link" in content:
                assert '<a href="https://example.com/relative/page">' in content, \
                    f"Relative URL not resolved in {fname}"
                return
    assert False, "Never found content with link text"
```

- [ ] **Step 3: Add test for nav links being skipped**

After the test from step 2:

```python
def test_reinject_links_skips_nav_links(tmp_path, monkeypatch):
    """Links in <nav>/<aside> outside article container are not reinjected."""
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import server

    monkeypatch.setattr(server, "WORK_DIR", tmp_path)
    monkeypatch.setattr(server, "_reinject_images", lambda html, orig, url: html)
    monkeypatch.setattr(server, "_fetch_and_embed_images", lambda html, book, url="": html)

    html = """
<html><head><title>Test Article</title></head><body>
<nav><a href="https://spam.com">Nav Link</a></nav>
<article>
<h1>Test Article</h1>
<p>This article has enough text to pass trafilatura extraction threshold.
The article covers various topics in software engineering and technology.
We need enough text so trafilatura processes this as a real article.
Machine learning has transformed many fields including computer vision.
Deep neural networks can now generate realistic images from text descriptions.
Transfer learning allows models to be fine-tuned with minimal labeled data.
Natural language processing has seen dramatic improvements in recent years.
Modern web applications rely on complex stacks of distributed technologies.
Container orchestration simplifies deployment across cloud infrastructure.
Open source software powers a significant fraction of internet infrastructure.
</p>
</article>
<aside><a href="https://ads.com">Sidebar Link</a></aside>
</body></html>
"""

    epub_path = server._html_to_article_epub(
        "https://example.com/article", html, keep_links=True
    )

    with zipfile.ZipFile(epub_path) as zf:
        all_text = ""
        for fname in zf.namelist():
            if fname.endswith(".xhtml") and "nav" not in fname and "details" not in fname:
                all_text += zf.read(fname).decode("utf-8", errors="replace")

    # "Nav Link" and "Sidebar Link" should NOT appear as clickable links
    # (they may or may not appear as text, but not as <a> tags)
    assert 'href="https://spam.com"' not in all_text, \
        "Nav link should not be reinjected"
    assert 'href="https://ads.com"' not in all_text, \
        "Sidebar link should not be reinjected"
```

- [ ] **Step 4: Run all toggle tests**

Run: `python -m pytest tests/test_toggles.py -v`

Expected: All 7+ tests pass (4 existing + 3 new)

- [ ] **Step 5: Commit**

```bash
git add tests/test_toggles.py
git commit -m "test: add tests for link reinjection (restore, relative URLs, nav exclusion)"
```

---

### Task 4: Full test run

- [ ] **Step 1: Run full test suite**

Run: `python -m pytest tests/ -v`

Expected: All existing tests pass.

- [ ] **Step 2: Quick smoke test (manual)**

Start server: `python3 server.py` then from another terminal:

```bash
curl -s -X POST http://127.0.0.1:5001/article/generate-preview \
  -H "Content-Type: application/json" \
  -d '{"url":"https://en.wikipedia.org/wiki/Python_(programming_language)","keepLinks":true}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('url',''))"
```

Open the returned URL in a browser and verify inline links (e.g. "Guido van Rossum") appear as clickable blue hyperlinks.

- [ ] **Step 3: Commit if smoke test passes**

```bash
git add -A
git commit -m "chore: finalize link reinjection implementation"
```
