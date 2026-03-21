from pydantic import BaseModel, EmailStr


class SignupRequest(BaseModel):
    email: EmailStr
    full_name: str
    password: str
    organization_name: str


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


class MeResponse(BaseModel):
    user_id: int
    email: str
    full_name: str
    organization_id: int
