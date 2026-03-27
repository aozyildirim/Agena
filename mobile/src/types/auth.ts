export interface LoginRequest {
  email: string;
  password: string;
}

export interface SignupRequest {
  email: string;
  full_name: string;
  password: string;
  organization_name: string;
}

export interface AuthResponse {
  access_token: string;
  user_id: number;
  organization_id: number;
  full_name: string;
  email: string;
  org_slug?: string;
  org_name?: string;
}

export interface MeResponse {
  user_id: number;
  email: string;
  full_name?: string;
  organization_id: number;
  org_slug?: string;
  org_name?: string;
}
