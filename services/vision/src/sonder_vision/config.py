from functools import lru_cache

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="VISION_", env_file=".env", extra="ignore")

    # Shared secret the web backend sends as a bearer token. When unset, every
    # protected endpoint refuses requests rather than running unauthenticated.
    service_token: SecretStr | None = Field(default=None, min_length=16)
    max_upload_bytes: int = Field(default=20 * 1024 * 1024, gt=0)
    max_image_pixels: int = Field(default=50_000_000, gt=0)


@lru_cache
def get_settings() -> Settings:
    return Settings()
