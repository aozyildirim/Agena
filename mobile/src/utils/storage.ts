import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'tiqr_token';
const SLUG_KEY = 'tiqr_org_slug';
const LANG_KEY = 'tiqr_lang';

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function removeToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export async function getOrgSlug(): Promise<string | null> {
  return SecureStore.getItemAsync(SLUG_KEY);
}

export async function setOrgSlug(slug: string): Promise<void> {
  await SecureStore.setItemAsync(SLUG_KEY, slug);
}

export async function getLang(): Promise<string> {
  return (await SecureStore.getItemAsync(LANG_KEY)) || 'tr';
}

export async function setLang(lang: string): Promise<void> {
  await SecureStore.setItemAsync(LANG_KEY, lang);
}
