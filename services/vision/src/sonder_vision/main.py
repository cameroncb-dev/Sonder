import os
from typing import Literal

from .config import get_settings

# OpenCV reads this once, on first decode; it guards against decompression bombs.
os.environ.setdefault("OPENCV_IO_MAX_IMAGE_PIXELS", str(get_settings().max_image_pixels))

import cv2  # noqa: E402
import numpy as np  # noqa: E402
from fastapi import Depends, FastAPI, HTTPException, UploadFile, status  # noqa: E402
from pydantic import BaseModel  # noqa: E402

from . import __version__  # noqa: E402
from .limits import BodySizeLimitMiddleware
from .security import BearerCredentials, SettingsDep, require_service_token, token_matches


class Health(BaseModel):
    status: Literal["ok"] = "ok"
    service: Literal["vision"] = "vision"
    version: str
    authenticated: bool


class ImageInfo(BaseModel):
    width: int
    height: int
    channels: int


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Sonder Vision", version=__version__, docs_url=None, redoc_url=None)
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.max_upload_bytes)

    @app.get("/health")
    def health(settings: SettingsDep, credentials: BearerCredentials) -> Health:
        """Public liveness check. Reports whether the caller's token was accepted."""
        return Health(version=__version__, authenticated=token_matches(settings, credentials))

    @app.post("/v1/images/inspect", dependencies=[Depends(require_service_token)])
    async def inspect_image(file: UploadFile) -> ImageInfo:
        """Decodes an uploaded image and reports its dimensions. Used to verify the
        authenticated upload path; palette and diff endpoints arrive in Phase 7."""
        data = await file.read()
        image = _decode(data)
        channels = 1 if image.ndim == 2 else int(image.shape[2])
        return ImageInfo(width=int(image.shape[1]), height=int(image.shape[0]), channels=channels)

    return app


def _decode(data: bytes) -> np.ndarray:
    buffer = np.frombuffer(data, dtype=np.uint8)
    image = cv2.imdecode(buffer, cv2.IMREAD_UNCHANGED) if buffer.size else None
    if image is None:
        # Also covers images over OPENCV_IO_MAX_IMAGE_PIXELS, which OpenCV refuses to decode.
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "File is not a decodable image or exceeds the pixel limit",
        )
    return image


app = create_app()

__all__ = ["app", "create_app"]
