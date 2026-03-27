import { apiFetch } from './apiClient';
import type { LoginRequest, SignupRequest, AuthResponse, MeResponse } from '../types/auth';

export async function login(data: LoginRequest): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function signup(data: SignupRequest): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/auth/signup', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getMe(): Promise<MeResponse> {
  return apiFetch<MeResponse>('/auth/me');
}
