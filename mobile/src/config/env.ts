import Constants from 'expo-constants';

const extra = Constants.expoConfig?.extra ?? {};

export const API_BASE_URL: string =
  (extra.apiBaseUrl as string) || 'http://localhost:8010';

export const APP_NAME = 'Tiqr';
