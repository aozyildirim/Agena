from datetime import UTC, datetime, timedelta

from jose import JWTError, jwt

from agena_core.settings import get_settings

settings = get_settings()


def create_access_token(
    subject: str,
    org_id: int,
    user_id: int,
    *,
    is_platform_admin: bool = False,
    token_version: int = 0,
) -> str:
    now = datetime.now(tz=UTC)
    payload: dict = {
        'sub': subject,
        'org_id': org_id,
        'user_id': user_id,
        'iat': now,
        'exp': now + timedelta(minutes=settings.jwt_access_token_exp_minutes),
        # Compared against users.token_version on every request; bumping
        # that column (password change, sign-out-everywhere) ends every
        # session issued before it.
        'ver': int(token_version or 0),
    }
    if is_platform_admin:
        payload['pa'] = True
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:
        raise ValueError('Invalid token') from exc
