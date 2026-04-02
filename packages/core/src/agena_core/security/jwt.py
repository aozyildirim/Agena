from datetime import UTC, datetime, timedelta

from jose import JWTError, jwt

from agena_core.settings import get_settings

settings = get_settings()


def create_access_token(subject: str, org_id: int, user_id: int) -> str:
    expire = datetime.now(tz=UTC) + timedelta(minutes=settings.jwt_access_token_exp_minutes)
    payload = {
        'sub': subject,
        'org_id': org_id,
        'user_id': user_id,
        'exp': expire,
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:
        raise ValueError('Invalid token') from exc
