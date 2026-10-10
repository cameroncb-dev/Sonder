import cv2
import numpy as np
from fastapi.testclient import TestClient

from .conftest import TOKEN

AUTH = {"Authorization": f"Bearer {TOKEN}"}


def png(width: int = 8, height: int = 4) -> bytes:
    ok, encoded = cv2.imencode(".png", np.zeros((height, width, 3), dtype=np.uint8))
    assert ok
    return encoded.tobytes()


def test_health_is_public_and_reports_auth(client: TestClient) -> None:
    anonymous = client.get("/health").json()
    assert anonymous["status"] == "ok"
    assert anonymous["authenticated"] is False
    assert client.get("/health", headers=AUTH).json()["authenticated"] is True


def test_protected_endpoint_requires_token(client: TestClient) -> None:
    files = {"file": ("a.png", png(), "image/png")}
    assert client.post("/v1/images/inspect", files=files).status_code == 401
    bad = {"Authorization": "Bearer wrong-token-0123456789"}
    assert client.post("/v1/images/inspect", files=files, headers=bad).status_code == 401


def test_protected_endpoint_refuses_when_token_unconfigured(make_client) -> None:  # type: ignore[no-untyped-def]
    client = make_client(token=None)
    files = {"file": ("a.png", png(), "image/png")}
    assert client.post("/v1/images/inspect", files=files, headers=AUTH).status_code == 503


def test_inspect_returns_dimensions(client: TestClient) -> None:
    files = {"file": ("a.png", png(8, 4), "image/png")}
    response = client.post("/v1/images/inspect", files=files, headers=AUTH)
    assert response.status_code == 200
    assert response.json() == {"width": 8, "height": 4, "channels": 3}


def test_rejects_non_image(client: TestClient) -> None:
    files = {"file": ("a.png", b"not an image", "image/png")}
    assert client.post("/v1/images/inspect", files=files, headers=AUTH).status_code == 422


def test_rejects_oversized_upload(make_client) -> None:  # type: ignore[no-untyped-def]
    client = make_client(max_upload_bytes=1024)
    files = {"file": ("big.bin", b"\0" * 4096, "application/octet-stream")}
    response = client.post("/v1/images/inspect", files=files, headers=AUTH)
    assert response.status_code == 413
