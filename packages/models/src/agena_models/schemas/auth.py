import re

from pydantic import BaseModel, EmailStr, field_validator

SLUG_PATTERN = re.compile(r'^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$')


class SignupRequest(BaseModel):
    email: EmailStr
    full_name: str
    password: str
    organization_name: str
    org_slug: str = ''

    @field_validator('org_slug')
    @classmethod
    def validate_slug(cls, v: str) -> str:
        if not v:
            return v  # will be auto-generated from org name
        if not SLUG_PATTERN.match(v):
            raise ValueError(
                'Slug must be lowercase alphanumeric with hyphens, '
                '1-63 chars, starting and ending with a letter or digit'
            )
        return v


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = 'bearer'
    user_id: int
    organization_id: int
    full_name: str = ''
    email: str = ''
    org_slug: str = ''
    org_name: str = ''
    is_platform_admin: bool = False


class MeResponse(BaseModel):
    user_id: int
    email: str
    full_name: str
    organization_id: int
    org_slug: str = ''
    org_name: str = ''
    is_platform_admin: bool = False
    org_role: str = 'member'
    # Permission keys the user holds in the active workspace (resolved from
    # the X-Workspace-Id header). Empty list when no header was sent.
    permissions: list[str] = []
