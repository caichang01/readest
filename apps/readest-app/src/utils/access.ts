import { jwtDecode } from 'jwt-decode';
import { supabase } from '@/utils/supabase';
import { isWebAppPlatform } from '@/services/environment';
import { getDailyUsage } from '@/services/translators/utils';
import { getRuntimeConfig } from '@/services/runtimeConfig';

interface Token {
  storage_usage_bytes: number;
  [key: string]: string | number;
}

const positiveLimitOrNull = (value: number | undefined): number | null =>
  value !== undefined && Number.isFinite(value) && value > 0 ? value : null;

export const getStoragePolicyData = (token: string) => {
  const data = jwtDecode<Token>(token) || {};
  const usage = data['storage_usage_bytes'] || 0;
  const runtimeConfig = getRuntimeConfig();
  const configuredLimit =
    runtimeConfig?.storageLimitBytes ??
    Number.parseInt(
      process.env['STORAGE_LIMIT_BYTES'] ?? process.env['STORAGE_FIXED_QUOTA'] ?? '0',
      10,
    );

  return {
    usage,
    limit: positiveLimitOrNull(configuredLimit),
  };
};

export const isStorageLimitExceeded = (
  usage: number,
  incomingBytes: number,
  limit: number | null,
): boolean => limit !== null && usage + incomingBytes > limit;

export const getTranslationDailyLimit = (): number | null => {
  const runtimeConfig = getRuntimeConfig();
  const configuredLimit =
    runtimeConfig?.translationDailyLimit ??
    Number.parseInt(
      process.env['TRANSLATION_DAILY_LIMIT'] ?? process.env['TRANSLATION_FIXED_QUOTA'] ?? '0',
      10,
    );
  return positiveLimitOrNull(configuredLimit);
};

export const getTranslationUsageData = () => ({
  usage: getDailyUsage() || 0,
  limit: getTranslationDailyLimit(),
});

export const getDailyTranslationPolicyData = () => ({
  limit: getTranslationDailyLimit(),
});

export const getAccessToken = async (): Promise<string | null> => {
  // In browser context there might be two instances of supabase one in the app route
  // and the other in the pages route, and they might have different sessions
  // making the access token invalid for API calls. In that case we should use localStorage.
  if (isWebAppPlatform()) {
    return localStorage.getItem('token') ?? null;
  }
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token ?? null;
};

export const getUserID = async (): Promise<string | null> => {
  if (isWebAppPlatform()) {
    const user = localStorage.getItem('user') ?? '{}';
    return JSON.parse(user).id ?? null;
  }
  const { data } = await supabase.auth.getSession();
  return data?.session?.user?.id ?? null;
};

export const validateUserAndToken = async (authHeader: string | null | undefined) => {
  if (!authHeader) return {};

  const token = authHeader.replace('Bearer ', '');
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) return {};
  return { user, token };
};
