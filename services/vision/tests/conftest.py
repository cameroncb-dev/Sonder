from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from sonder_vision.config import get_settings
from sonder_vision.main import create_app

TOKEN = "test-token-0123456789abcdef"


@pytest.fixture
def make_client(monkeypatch: pytest.MonkeyPatch) -> Iterator[object]:
    def factory(token: str | None = TOKEN, max_upload_bytes: int | None = None) -> TestClient:
        monkeypatch.delenv("VISION_SERVICE_TOKEN", raising=False)
        if token is not None:
            monkeypatch.setenv("VISION_SERVICE_TOKEN", token)
        if max_upload_bytes is not None:
            monkeypatch.setenv("VISION_MAX_UPLOAD_BYTES", str(max_upload_bytes))
        get_settings.cache_clear()
        return TestClient(create_app())

    yield factory
    get_settings.cache_clear()


@pytest.fixture
def client(make_client) -> TestClient:  # type: ignore[no-untyped-def]
    return make_client()  # type: ignore[no-any-return]
