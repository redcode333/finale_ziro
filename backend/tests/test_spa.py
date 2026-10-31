"""Serving the React build from FastAPI: SPA fallback, API precedence, JSON 404s for API typos, no traversal."""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.errors import register_error_handlers
from app.spa import mount_spa


@pytest.fixture
def web(tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>app</html>")
    (dist / "assets" / "index-abc.js").write_text("console.log(1)")
    (dist / "favicon.svg").write_text("<svg/>")
    (tmp_path / "secret.txt").write_text("outside dist")
    app = FastAPI()
    register_error_handlers(app)

    @app.get("/approvals")
    def approvals():
        return ["api"]

    @app.get("/health")
    def health():
        return {"status": "ok"}

    assert mount_spa(app, dist)
    return TestClient(app)


def test_root_and_client_routes_serve_index_for_refresh(web):
    for path in ("/", "/signin", "/admin/approvals", "/contributor/tasks", "/some/deep/link"):
        r = web.get(path)
        assert r.status_code == 200 and "<html>app</html>" in r.text and r.headers["cache-control"] == "no-cache", path


def test_api_routes_take_precedence_over_the_catch_all(web):
    assert web.get("/approvals").json() == ["api"]  # not index.html, even though the SPA has /admin/approvals
    assert web.get("/health").json() == {"status": "ok"}


def test_unknown_api_paths_stay_json_404(web):
    for path in ("/teams/team_fs_001/nope", "/agent-runs/x/nope", "/approvals/x/nope", "/docs/nope"):
        r = web.get(path)
        assert r.status_code == 404 and r.json()["code"] == "http_error", path


def test_static_files_and_caching(web):
    js = web.get("/assets/index-abc.js")
    assert js.status_code == 200 and "immutable" in js.headers["cache-control"]
    assert web.get("/favicon.svg").status_code == 200
    assert web.get("/assets/old-hash.js").status_code == 404  # missing bundle is a 404, never HTML


def test_path_traversal_is_blocked(web):
    for path in ("/../secret.txt", "/%2e%2e/secret.txt", "/assets/../../secret.txt", "/..%2fsecret.txt"):
        r = web.get(path)
        assert "outside dist" not in r.text, path


def test_non_get_methods_are_not_served(web):
    assert web.post("/signin").status_code == 405


def test_nothing_is_mounted_without_a_build(tmp_path):
    app = FastAPI()
    assert mount_spa(app, tmp_path / "missing") is False
    assert TestClient(app).get("/signin").status_code == 404
