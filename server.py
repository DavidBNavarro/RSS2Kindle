#!/usr/bin/env python3
"""Web2Kindle — Flask backend for the Web2Kindle Chrome extension."""

import base64
import os
import re
import uuid
import tempfile
from urllib.parse import urljoin, urlparse
import shutil
import smtplib
import atexit
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email.mime.text import MIMEText
from email import encoders
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
import json

import requests as http_requests

CONFIG_PATH = Path(__file__).parent / "config.json"

def _load_config() -> dict:
    if CONFIG_PATH.exists():
        with open(CONFIG_PATH) as f:
            return json.load(f)
    return {}

CONFIG = _load_config()
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

APP_VERSION = "1.0.0"
WORK_DIR = Path(tempfile.mkdtemp(prefix="web2kindle_"))
HISTORY_DB = Path(__file__).parent / "history.db"
FETCH_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; Web2Kindle/1.0)"}
GMAIL_MESSAGE_LIMIT_BYTES = 25 * 1024 * 1024
GMAIL_SAFETY_MARGIN_BYTES = 256 * 1024
KINDLE_MAX_EPUB_BYTES = 50 * 1024 * 1024
DELIVERY_IMAGE_MAX_DIMENSION = 1600
DELIVERY_JPEG_QUALITY = 75


def _init_history_db():
    with sqlite3.connect(HISTORY_DB) as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS sent_history (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                title    TEXT NOT NULL,
                url      TEXT,
                sent_at  TEXT NOT NULL,
                content  TEXT,
                status   TEXT NOT NULL DEFAULT 'sent',
                error    TEXT
            );
            CREATE VIRTUAL TABLE IF NOT EXISTS sent_history_fts
                USING fts5(title, url, content,
                           content='sent_history', content_rowid='id');
            CREATE TRIGGER IF NOT EXISTS sent_history_ai
                AFTER INSERT ON sent_history BEGIN
                    INSERT INTO sent_history_fts(rowid, title, url, content)
                    VALUES (new.id, new.title, new.url, new.content);
                END;
            CREATE TRIGGER IF NOT EXISTS sent_history_ad
                AFTER DELETE ON sent_history BEGIN
                    INSERT INTO sent_history_fts(sent_history_fts, rowid, title, url, content)
                    VALUES ('delete', old.id, old.title, old.url, old.content);
                END;
        """)
        for col, definition in (("status", "TEXT NOT NULL DEFAULT 'sent'"), ("error", "TEXT")):
            try:
                conn.execute(f"ALTER TABLE sent_history ADD COLUMN {col} {definition}")
            except sqlite3.OperationalError:
                pass

_init_history_db()


def _log_sent(title: str, url: str, epub_path: str = None, *,
              status: str = "sent", error: str = None):
    content = ""
    if epub_path:
        try:
            from ebooklib import epub as epub_lib
            from html.parser import HTMLParser

            class _Strip(HTMLParser):
                def __init__(self): super().__init__(); self.text = []
                def handle_data(self, d): self.text.append(d)

            book = epub_lib.read_epub(epub_path, options={"ignore_ncx": True})
            parts = []
            for item in book.get_items_of_type(9):
                p = _Strip()
                p.feed(item.get_content().decode("utf-8", errors="replace"))
                parts.append(" ".join(p.text))
            content = " ".join(parts)[:50_000]
        except Exception:
            pass

    with sqlite3.connect(HISTORY_DB) as conn:
        conn.execute(
            "INSERT INTO sent_history (title, url, sent_at, content, status, error)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (title, url or "", datetime.now(timezone.utc).isoformat(), content, status, error)
        )


atexit.register(lambda: shutil.rmtree(WORK_DIR, ignore_errors=True))


def _health_capabilities() -> dict:
    return {
        "article_routes": False,
        "article_send_to_kindle": False,
        "article_generate_preview": False,
        "pdf_routes": False,
        "send_epub": True,
    }


def _esc(t: str) -> str:
    return (t.replace("&", "&amp;").replace("<", "&lt;")
             .replace(">", "&gt;").replace('"', "&quot;"))


_RE_KINDLE_UNSAFE = re.compile(
    "[\u200d\u2600-\u27bf\ufe0e-\ufe0f"
    "\U0001f300-\U0001f9ff"
    "\U0001fa00-\U0001fa6f"
    "\U0001fa70-\U0001faff"
    "\U0001f600-\U0001f64f"
    "\U0001f680-\U0001f6ff"
    "\U0001f900-\U0001f9ff"
    "]"
)

def _sanitize_for_kindle(text: str) -> str:
    if not text:
        return text
    text = _RE_KINDLE_UNSAFE.sub("", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = re.sub(r"\n[ \t]+", "\n", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    return text.strip()


def _epub_filename(epub_path: str, title: str = "") -> str:
    stem = title or Path(epub_path).stem
    safe = re.sub(r"[^A-Za-z0-9 ]+", " ", stem).strip(" ")[:80]
    if not safe or re.match(r"^tmp[a-z0-9]{3,12}$", safe):
        safe = "document"
    return f"{safe}.epub"


def _is_gmail_smtp_host(host: str) -> bool:
    return "gmail" in (host or "").lower()


def _parse_recipients(kindle_email_str: str) -> list[str]:
    return [e.strip() for e in kindle_email_str.split(",") if e.strip()]


def _build_epub_email_message(cfg: dict, epub_path: str, filename: str | None = None) -> MIMEMultipart:
    msg = MIMEMultipart()
    msg["From"] = cfg["smtp_user"]
    emails = _parse_recipients(cfg["kindle_email"])
    msg["To"] = emails[0] if emails else cfg["kindle_email"]
    msg["Subject"] = "convert"
    msg.attach(MIMEText("Sent from Web2Kindle", "plain"))
    with open(epub_path, "rb") as f:
        part = MIMEBase("application", "epub+zip")
        part.set_payload(f.read())
        encoders.encode_base64(part)
        fn = filename or _epub_filename(epub_path)
        part.add_header("Content-Disposition", f'attachment; filename="{fn}"')
        msg.attach(part)
    return msg


def _estimate_epub_email_size(cfg: dict, epub_path: str, filename: str | None = None) -> int:
    try:
        msg = _build_epub_email_message(cfg, epub_path, filename=filename)
        return len(msg.as_bytes())
    except Exception:
        return Path(epub_path).stat().st_size


def _delivery_size_error_message(
    raw_bytes: int, estimated_bytes: int, *,
    optimization_attempted: bool = False,
    optimized_raw_bytes: int = 0,
    optimized_estimated_bytes: int = 0,
) -> str:
    gmail_budget = (GMAIL_MESSAGE_LIMIT_BYTES - GMAIL_SAFETY_MARGIN_BYTES) // (1024 * 1024)
    if optimization_attempted:
        return (
            f"EPUB still too large for Gmail ({optimized_raw_bytes / (1024 * 1024):.1f} MB, "
            f"estimated {optimized_estimated_bytes / (1024 * 1024):.1f} MB after optimization). "
            f"Gmail allows ~{gmail_budget} MB with base64 overhead. "
            f"Try sending a version with fewer or lower-resolution images."
        )
    return (
        f"EPUB too large ({raw_bytes / (1024 * 1024):.1f} MB, "
        f"estimated {estimated_bytes / (1024 * 1024):.1f} MB with base64). "
        f"Gmail allows ~{gmail_budget} MB. "
        f"Try disabling image embedding or reducing image sizes."
    )


def _optimize_epub_for_delivery(epub_path: str) -> tuple[str, dict]:
    import zipfile
    from PIL import Image
    from io import BytesIO

    tmp_dir = WORK_DIR / f"epub_opt_{uuid.uuid4().hex}"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    optimized_path = str(tmp_dir / "optimized.epub")
    removed_preview_assets = 0
    recompressed_images = 0

    with zipfile.ZipFile(epub_path, "r") as zin:
        with zipfile.ZipFile(optimized_path, "w", zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                data = zin.read(item.filename)
                name = item.filename.lower()
                if "preview" in name and name.endswith((".png", ".jpg", ".jpeg", ".gif", ".webp")):
                    removed_preview_assets += 1
                    continue
                if name.endswith((".png", ".jpg", ".jpeg")):
                    try:
                        img = Image.open(BytesIO(data))
                        if img.mode in ("RGBA", "P"):
                            img = img.convert("RGB")
                        w, h = img.size
                        if w > DELIVERY_IMAGE_MAX_DIMENSION or h > DELIVERY_IMAGE_MAX_DIMENSION:
                            img.thumbnail((DELIVERY_IMAGE_MAX_DIMENSION, DELIVERY_IMAGE_MAX_DIMENSION), Image.LANCZOS)
                        buf = BytesIO()
                        img.save(buf, format="JPEG", quality=DELIVERY_JPEG_QUALITY, optimize=True)
                        data = buf.getvalue()
                        recompressed_images += 1
                    except Exception:
                        pass
                zout.writestr(item, data)

    return optimized_path, {
        "optimized": True,
        "removed_preview_assets": removed_preview_assets,
        "recompressed_images": recompressed_images,
    }


def _send_epub_to_kindle(cfg: dict, epub_path: str, title: str = "") -> dict:
    missing = [k for k in ("kindle_email", "smtp_host", "smtp_port", "smtp_user", "smtp_password")
               if not cfg.get(k)]
    if missing:
        raise ValueError(f"Missing SMTP config: {', '.join(missing)}")
    raw_bytes = Path(epub_path).stat().st_size
    if raw_bytes > KINDLE_MAX_EPUB_BYTES:
        raise ValueError(
            f"EPUB too large ({raw_bytes / (1024 * 1024):.1f} MB). Kindle limit is 50 MB."
        )

    filename = _epub_filename(epub_path, title=title)
    estimated_bytes = _estimate_epub_email_size(cfg, epub_path, filename=filename)
    gmail_budget = GMAIL_MESSAGE_LIMIT_BYTES - GMAIL_SAFETY_MARGIN_BYTES
    use_gmail_budget = _is_gmail_smtp_host(cfg.get("smtp_host", ""))

    send_path = epub_path
    optimized_path = None
    optimization_meta = {
        "optimized": False,
        "removed_preview_assets": 0,
        "recompressed_images": 0,
    }
    final_raw_bytes = raw_bytes
    final_estimated_bytes = estimated_bytes

    try:
        if use_gmail_budget and estimated_bytes > gmail_budget:
            optimized_path, optimization_meta = _optimize_epub_for_delivery(epub_path)
            final_raw_bytes = Path(optimized_path).stat().st_size
            if final_raw_bytes > KINDLE_MAX_EPUB_BYTES:
                raise ValueError(
                    f"EPUB too large ({final_raw_bytes / (1024 * 1024):.1f} MB). Kindle limit is 50 MB."
                )
            final_estimated_bytes = _estimate_epub_email_size(cfg, optimized_path, filename=filename)
            if final_estimated_bytes > gmail_budget:
                raise ValueError(_delivery_size_error_message(
                    raw_bytes, estimated_bytes,
                    optimization_attempted=True,
                    optimized_raw_bytes=final_raw_bytes,
                    optimized_estimated_bytes=final_estimated_bytes,
                ))
            send_path = optimized_path

        recipients = _parse_recipients(cfg["kindle_email"])
        # DEBUG: save final EPUB sent to Kindle
        import shutil
        shutil.copy2(send_path, "/tmp/debug_final_sent.epub")
        msg = _build_epub_email_message(cfg, send_path, filename=filename)
        with smtplib.SMTP(cfg["smtp_host"], int(cfg["smtp_port"])) as server:
            server.ehlo(); server.starttls(); server.ehlo()
            server.login(cfg["smtp_user"], cfg["smtp_password"])
            server.send_message(msg, to_addrs=recipients)

        result = {
            "kindle_email": ", ".join(recipients),
            "delivery_meta": {
                "gmail_budget_applied": use_gmail_budget,
                "optimized": bool(optimization_meta.get("optimized")),
                "original_epub_bytes": raw_bytes,
                "original_estimated_message_bytes": estimated_bytes,
                "final_epub_bytes": final_raw_bytes,
                "final_estimated_message_bytes": final_estimated_bytes,
                "removed_preview_assets": optimization_meta.get("removed_preview_assets", 0),
                "recompressed_images": optimization_meta.get("recompressed_images", 0),
            },
        }
        if optimization_meta.get("optimized"):
            result["delivery_notice"] = "Images were optimized to fit Gmail's size limit."
        return result
    finally:
        if optimized_path and optimized_path != epub_path:
            Path(optimized_path).unlink(missing_ok=True)





# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/send-epub", methods=["POST"])
def send_epub():
    file = request.files.get("epub")
    if not file:
        return jsonify({"error": "No EPUB file provided"}), 400
    title = request.form.get("title") or "Article"
    url = request.form.get("url", "")
    cfg = {
        "kindle_email": request.form.get("kindle_email") or CONFIG.get("kindle_email", ""),
        "smtp_host": request.form.get("smtp_host") or CONFIG.get("smtp_host", ""),
        "smtp_port": request.form.get("smtp_port") or CONFIG.get("smtp_port", ""),
        "smtp_user": request.form.get("smtp_user") or CONFIG.get("smtp_user", ""),
        "smtp_password": request.form.get("smtp_password") or CONFIG.get("smtp_password", ""),
    }
    send_error = None
    epub_path = None
    try:
        tmp = tempfile.NamedTemporaryFile(suffix=".epub", delete=False)
        tmp_path = tmp.name
        tmp.close()
        file.save(tmp_path)
        # DEBUG: save a copy for epubcheck inspection
        import shutil
        shutil.copy2(tmp_path, "/tmp/debug_sent.epub")
        epub_path = tmp_path
        result = _send_epub_to_kindle(cfg, epub_path, title=title)
        return jsonify({"success": True, **result})
    except ValueError as e:
        send_error = str(e)
        return jsonify({"error": send_error}), 400
    except Exception as e:
        send_error = str(e)
        return jsonify({"error": send_error}), 500
    finally:
        if epub_path:
            _log_sent(title, url, epub_path, status="failed" if send_error else "sent", error=send_error)
            Path(epub_path).unlink(missing_ok=True)


@app.route("/send-html", methods=["POST"])
def send_html():
    from ebooklib import epub as epub_lib
    from bs4 import BeautifulSoup
    data = request.get_json()
    if not data:
        return jsonify({"error": "No JSON body"}), 400
    title = data.get("title") or "Article"
    html_content = data.get("html", "")
    url = data.get("url", "")
    cfg = {
        "kindle_email": data.get("kindle_email") or CONFIG.get("kindle_email", ""),
        "smtp_host": data.get("smtp_host") or CONFIG.get("smtp_host", ""),
        "smtp_port": data.get("smtp_port") or CONFIG.get("smtp_port", ""),
        "smtp_user": data.get("smtp_user") or CONFIG.get("smtp_user", ""),
        "smtp_password": data.get("smtp_password") or CONFIG.get("smtp_password", ""),
    }
    if not html_content:
        return jsonify({"error": "No HTML content provided"}), 400

    soup = BeautifulSoup(html_content, "html.parser")
    for tag in soup.find_all(["script", "style", "link"]):
        tag.decompose()
    for img in soup.find_all("img"):
        src = img.get("src", "")
        if src.startswith("blob:"):
            img.decompose()

    _HTML5_ONLY_TAGS = {"figure", "picture", "video", "audio", "source", "track", "canvas", "svg", "nav"}
    for tag_name in _HTML5_ONLY_TAGS:
        for tag in soup.find_all(tag_name):
            if tag_name == "picture":
                img = tag.find("img")
                if img:
                    tag.replace_with(img)
            elif tag_name in ("figure", "nav"):
                tag.unwrap()
            else:
                tag.decompose()

    _HTML5_ATTR_RE = re.compile(
        r"^(aria-|on\w+|role|tabindex|playsinline|webkit-playsinline"
        r"|moz-playsinline|allow|allowfullscreen|allowtransparency"
        r"|frameborder|scrolling|marginwidth|marginheight"
        r"|msallowfullscreen|mozallowfullscreen|webkitallowfullscreen"
        r"|loading|sizes|srcset|currentsrc|currentsourceurl)$",
        re.I,
    )
    for tag in soup.find_all(True):
        to_remove = [
            a for a in list(tag.attrs)
            if _HTML5_ATTR_RE.match(a)
            or (":" in a and not a.startswith("xml:") and a != "xmlns")
            or not a
        ]
        for attr in to_remove:
            del tag.attrs[attr]

    html_str = _sanitize_for_kindle(str(soup))

    book = epub_lib.EpubBook()
    book.set_identifier(str(uuid.uuid4()))
    book.set_title(title)
    book.set_language("en")

    page = epub_lib.EpubHtml(title=title, file_name="article.xhtml", lang="en")
    page.content = "<html><body>" + html_str + "</body></html>"
    book.add_item(page)

    epub_lib.EpubNcx()
    epub_lib.EpubNav()
    book.add_item(epub_lib.EpubNcx())
    book.add_item(epub_lib.EpubNav())
    book.toc = [epub_lib.Link("article.xhtml", title, "article")]
    book.spine = ["nav", page]

    css = epub_lib.EpubItem(uid="style", file_name="style.css", media_type="text/css",
                            content=b"body{font-family:Georgia,serif;font-size:12pt;line-height:1.5;margin:0;padding:20px;}"
                                    b"img{max-width:100%;height:auto;display:block;margin:1em auto;}")
    book.add_item(css)
    page.add_item(css)

    tmp = tempfile.NamedTemporaryFile(suffix=".epub", delete=False)
    tmp_path = tmp.name
    tmp.close()
    epub_lib.write_epub(tmp_path, book)

    send_error = None
    try:
        result = _send_epub_to_kindle(cfg, tmp_path, title=title)
        return jsonify({"success": True, **result})
    except ValueError as e:
        send_error = str(e)
        return jsonify({"error": send_error}), 400
    except Exception as e:
        send_error = str(e)
        return jsonify({"error": send_error}), 500
    finally:
        _log_sent(title, url, tmp_path, status="failed" if send_error else "sent", error=send_error)
        Path(tmp_path).unlink(missing_ok=True)


@app.route("/health")
def health():
    return jsonify({
        "status": "ok",
        "version": APP_VERSION,
        "capabilities": _health_capabilities(),
    })


@app.route("/history", methods=["GET"])
def get_history():
    q = request.args.get("q", "").strip()
    url_exact = request.args.get("url", "").strip()
    limit = min(int(request.args.get("limit", 50)), 200)
    with sqlite3.connect(HISTORY_DB) as conn:
        conn.row_factory = sqlite3.Row
        if url_exact:
            rows = conn.execute("""
                SELECT id, title, url, sent_at, status, error FROM sent_history
                WHERE url = ?
                ORDER BY sent_at DESC LIMIT 1
            """, (url_exact,)).fetchall()
            return jsonify([dict(r) for r in rows])
        if q:
            fts_query = " ".join(t + "*" for t in q.split())
            rows = conn.execute("""
                SELECT h.id, h.title, h.url, h.sent_at, h.status, h.error
                FROM sent_history_fts
                JOIN sent_history h ON sent_history_fts.rowid = h.id
                WHERE sent_history_fts MATCH ?
                ORDER BY rank
                LIMIT ?
            """, (fts_query, limit)).fetchall()
        else:
            rows = conn.execute("""
                SELECT id, title, url, sent_at, status, error FROM sent_history
                ORDER BY sent_at DESC LIMIT ?
            """, (limit,)).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/history/<int:item_id>", methods=["DELETE"])
def delete_history(item_id):
    with sqlite3.connect(HISTORY_DB) as conn:
        conn.execute("DELETE FROM sent_history WHERE id = ?", (item_id,))
    return jsonify({"success": True})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    debug = os.environ.get("P2K_DEBUG", "").lower() in {"1", "true", "yes", "on"}
    app.run(host="127.0.0.1", port=port, debug=debug, use_reloader=debug)
