import hmac
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import Settings, get_settings

_bearer = HTTPBearer(auto_error=False)

BearerCredentials = Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)]
SettingsDep = Annotated[Settings, Depends(get_settings)]


def token_matches(settings: Settings, credentials: HTTPAuthorizationCredentials | None) -> bool:
    if settings.service_token is None or credentials is None:
        return False
    expected = settings.service_token.get_secret_value().encode()
    return hmac.compare_digest(credentials.credentials.encode(), expected)


def require_service_token(settings: SettingsDep, credentials: BearerCredentials) -> None:
    if settings.service_token is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "VISION_SERVICE_TOKEN is not configured"
        )
    if not token_matches(settings, credentials):
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Invalid or missing service token",
            headers={"WWW-Authenticate": "Bearer"},
        )
