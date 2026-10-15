"""
Servidor local para testar o NOC Horizon SEM Docker (frontend + API numa porta).

Uso, a partir da raiz do projeto:
    python backend/dev_server.py
Abra http://localhost:8080 . Roda em modo demo por padrão (NOC_MODE=demo).

Apenas para desenvolvimento/estudo — em produção use Gunicorn + Apache/Nginx
ou o docker compose.
"""

import os
import sys
from pathlib import Path

os.environ.setdefault("NOC_MODE", "demo")

BACKEND = Path(__file__).resolve().parent
ROOT = BACKEND.parent
sys.path.insert(0, str(BACKEND))

from flask import abort, send_from_directory  # noqa: E402

from app import app  # noqa: E402

# Só estes arquivos/pastas do frontend são servidos (nunca backend/, .git/ etc.)
PUBLIC_FILES = {"index.html", "favicon.svg"}
PUBLIC_DIRS = {"css", "js", "public"}


@app.route("/")
def index():
    return send_from_directory(ROOT, "index.html")


@app.route("/<path:path>")
def frontend(path):
    if path in PUBLIC_FILES or path.split("/", 1)[0] in PUBLIC_DIRS:
        return send_from_directory(ROOT, path)
    abort(404)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    print(f"\n  NOC Horizon ({os.environ['NOC_MODE']}) em http://localhost:{port}\n")
    app.run(host="127.0.0.1", port=port, debug=False)
