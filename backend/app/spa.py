"""Serve the built React app (frontend/dist) from the same FastAPI service.

Registered after every API router, so real API routes always win; the catch-all only sees paths nothing else matched.
Does nothing when the build is absent, so local development and the test suite are unaffected.
"""
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse

# Unmatched paths under these prefixes are API typos and must stay a JSON 404, never the HTML app.
API_PREFIXES = {"auth", "agents", "agent-runs", "approvals", "reports", "github", "teams", "health", "docs", "redoc", "openapi.json"}
_NO_CACHE = {"Cache-Control": "no-cache"}
_IMMUTABLE = {"Cache-Control": "public, max-age=31536000, immutable"}  # /assets/* filenames are content-hashed


def mount_spa(app: FastAPI, dist: Path) -> bool:
    """Serve static files from `dist` and fall back to index.html for client-side routes. Returns whether it mounted."""
    root = dist.resolve()
    index = root / "index.html"
    if not index.is_file():
        return False

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.split("/", 1)[0] in API_PREFIXES:
            raise HTTPException(status_code=404, detail="Not Found")
        candidate = (root / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(root):  # is_relative_to blocks ../ traversal
            return FileResponse(candidate, headers=_IMMUTABLE if path.startswith("assets/") else None)
        if "." in path.rsplit("/", 1)[-1]:  # a missing file (e.g. an old hashed bundle), not a page: never answer with HTML
            raise HTTPException(status_code=404, detail="Not Found")
        return FileResponse(index, headers=_NO_CACHE)

    return True
