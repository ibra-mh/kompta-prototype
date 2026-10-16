import base64
import binascii
import os
import secrets
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from api import accounts_router, clients_router, export_portfolio_tva_excel, export_tva_excel, ocr_router, router as exports_router
from api import compute_liasse_endpoint, export_simpl_is, list_journal_audit, list_journal_entries, post_journal_entry, reverse_journal_entry, save_journal_draft

app = FastAPI(title="Kompta - DGI SIMPL Export Engine")
app.add_api_route("/api/journal-entries", list_journal_entries, methods=["GET"])
app.add_api_route("/api/journal-audit", list_journal_audit, methods=["GET"], tags=["journal"])
app.add_api_route("/api/journal-drafts", save_journal_draft, methods=["POST"], tags=["journal"])


def local_development_origins() -> list[str]:
    configured = os.environ.get("KOMPTA_DEV_CORS_ORIGINS", "")
    origins = [origin.strip() for origin in configured.split(",") if origin.strip()]
    for origin in origins:
        parsed = urlsplit(origin)
        try:
            port = parsed.port
        except ValueError as error:
            raise ValueError("Invalid local development CORS origin") from error
        if (
            origin == "*"
            or parsed.scheme != "http"
            or parsed.hostname not in {"127.0.0.1", "localhost"}
            or port is None
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError(
                "KOMPTA_DEV_CORS_ORIGINS accepts only exact http://localhost or "
                "http://127.0.0.1 origins with an explicit port"
            )
    return list(dict.fromkeys(origins))

# The standalone index.html is opened from file:// and sends Origin: null.
# This local CORS policy is not user authentication.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["null", *local_development_origins()],
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=[
        "Content-Type", "X-Kompta-Client-Id", "X-Kompta-Year",
        "X-Kompta-Filename", "X-Kompta-Client-Ice", "ngrok-skip-browser-warning",
    ],
    expose_headers=["Content-Disposition", "X-Kompta-Export-Status"],
)


def load_basic_auth() -> tuple[bytes, bytes] | None:
    configured = os.environ.get("KOMPTA_BASIC_AUTH", "")
    required = os.environ.get("KOMPTA_REQUIRE_AUTH") == "1"
    if not configured and not required:
        return None
    username, separator, password = configured.partition(":")
    if not separator or not username or not password:
        raise RuntimeError("KOMPTA_BASIC_AUTH must be set as 'username:password'")
    return username.encode("utf-8"), password.encode("utf-8")


BASIC_AUTH = load_basic_auth()


def basic_auth_matches(header: str) -> bool:
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "basic":
        return False
    try:
        username, separator, password = base64.b64decode(token.strip(), validate=True).partition(b":")
    except (binascii.Error, ValueError):
        return False
    expected_user, expected_password = BASIC_AUTH
    user_ok = secrets.compare_digest(username, expected_user)
    password_ok = secrets.compare_digest(password, expected_password)
    return bool(separator) and user_ok and password_ok


@app.middleware("http")
async def require_basic_auth(request: Request, call_next):
    if BASIC_AUTH is None or request.url.path == "/health":
        return await call_next(request)
    if basic_auth_matches(request.headers.get("authorization", "")):
        return await call_next(request)
    return Response(
        "Authentication required", status_code=401,
        headers={"WWW-Authenticate": 'Basic realm="Kompta", charset="UTF-8"'},
    )

app.include_router(exports_router)
app.include_router(clients_router)
app.include_router(accounts_router)
app.include_router(ocr_router)
# Public short route used by the browser Excel export action.
app.add_api_route("/export-tva-excel", export_tva_excel, methods=["POST"], tags=["dgi-exports"])
app.add_api_route("/api/export-tva-excel", export_tva_excel, methods=["POST"], tags=["dgi-exports"])
app.add_api_route("/export-portfolio-tva-excel", export_portfolio_tva_excel, methods=["POST"], tags=["dgi-exports"])
app.add_api_route("/api/liasse/compute", compute_liasse_endpoint, methods=["POST"], tags=["liasse"])
app.add_api_route("/api/liasse/simpl-is.xml", export_simpl_is, methods=["POST"], tags=["liasse"])
app.add_api_route("/api/journal-entries", post_journal_entry, methods=["POST"], tags=["journal"])
app.add_api_route("/api/journal-entries/{entry_id}/reversal", reverse_journal_entry, methods=["POST"], tags=["journal"])


@app.get("/health")
def health():
    return {"status": "ok"}


# Explicit routes only: mounting the project root would expose kompta.sqlite3.
WEB_ROOT = Path(__file__).resolve().parent


NO_CACHE = {"Cache-Control": "no-cache"}


@app.get("/", include_in_schema=False)
@app.get("/index.html", include_in_schema=False)
def index():
    return FileResponse(WEB_ROOT / "index.html", media_type="text/html", headers=NO_CACHE)


@app.get("/app.js", include_in_schema=False)
def app_js():
    return FileResponse(WEB_ROOT / "app.js", media_type="text/javascript", headers=NO_CACHE)


@app.get("/styles.css", include_in_schema=False)
def styles_css():
    return FileResponse(WEB_ROOT / "styles.css", media_type="text/css", headers=NO_CACHE)


app.mount("/vendor", StaticFiles(directory=WEB_ROOT / "vendor"), name="vendor")
