#!/usr/bin/env python3
"""SMTP Relay — minimal Flask server that sends EPUBs to Kindle via SMTP."""

import base64
import os
import smtplib
from email import encoders
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

APP_VERSION = "1.0.0"
KINDLE_MAX_EPUB_BYTES = 50 * 1024 * 1024
GMAIL_MESSAGE_LIMIT_BYTES = 25 * 1024 * 1024
GMAIL_SAFETY_MARGIN_BYTES = 256 * 1024

REQUIRED_FIELDS = [
    "epub", "kindle_email", "smtp_host", "smtp_port",
    "smtp_user", "smtp_password",
]


def _parse_recipients(kindle_email):
    if isinstance(kindle_email, list):
        return [e.strip() for e in kindle_email if e.strip()]
    return [e.strip() for e in kindle_email.split(",") if e.strip()]


@app.route("/health")
def health():
    return jsonify({
        "status": "ok",
        "service": "smtp-relay",
        "version": APP_VERSION,
    })


@app.route("/send", methods=["POST"])
def send():
    data = request.get_json(silent=True)
    if data is None:
        return jsonify({"error": "Request body must be JSON"}), 400

    missing = [f for f in REQUIRED_FIELDS if not data.get(f)]
    if missing:
        return jsonify({"error": f"Missing required fields: {', '.join(missing)}"}), 400

    try:
        epub_bytes = base64.b64decode(data["epub"])
    except Exception:
        return jsonify({"error": "epub must be valid base64"}), 400

    if len(epub_bytes) > KINDLE_MAX_EPUB_BYTES:
        return jsonify({
            "error": f"EPUB too large ({len(epub_bytes) / (1024 * 1024):.1f} MB). Kindle limit is 50 MB."
        }), 413

    recipients = _parse_recipients(data["kindle_email"])
    if not recipients:
        return jsonify({"error": "kindle_email must contain at least one valid address"}), 400

    msg = MIMEMultipart()
    msg["From"] = data["smtp_user"]
    msg["To"] = recipients[0]
    msg["Subject"] = "convert"
    msg.attach(MIMEText("Sent from Web2Kindle", "plain"))

    part = MIMEBase("application", "epub+zip")
    part.set_payload(epub_bytes)
    encoders.encode_base64(part)
    safe_name = "document.epub"
    part.add_header("Content-Disposition", f'attachment; filename="{safe_name}"')
    msg.attach(part)

    estimated_size = len(msg.as_bytes())

    notice = None
    gmail_budget = GMAIL_MESSAGE_LIMIT_BYTES - GMAIL_SAFETY_MARGIN_BYTES
    if "gmail" in data["smtp_host"].lower() and estimated_size > gmail_budget:
        notice = (
            f"Estimated message size ({estimated_size / (1024 * 1024):.1f} MB) "
            "exceeds Gmail's ~25 MB limit. Delivery may fail."
        )

    try:
        with smtplib.SMTP(data["smtp_host"], int(data["smtp_port"])) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(data["smtp_user"], data["smtp_password"])
            server.send_message(msg, to_addrs=recipients)
    except smtplib.SMTPAuthenticationError:
        return jsonify({"error": "SMTP authentication failed. Check your username and password."}), 401
    except smtplib.SMTPException as e:
        return jsonify({"error": f"SMTP error: {e}"}), 502
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    result = {
        "success": True,
        "kindle_email": ", ".join(recipients),
        "estimated_size_bytes": estimated_size,
        "notice": notice,
    }
    return jsonify(result), 200


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5002))
    app.run(host="0.0.0.0", port=port, debug=os.environ.get("P2K_DEBUG", ""))
