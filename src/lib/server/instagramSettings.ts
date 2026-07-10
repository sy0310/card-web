import 'server-only';

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export type StoredInstagramSettings = {
  id: string;
  session_id: string | null;
  settings_json: Record<string, unknown> | null;
  proxy: string | null;
  updated_at: string;
  updated_by: string | null;
};

export type InstagramSettingsStatus = {
  configured: boolean;
  database_session_configured: boolean;
  database_settings_configured: boolean;
  database_proxy_configured: boolean;
  environment_fallback_configured: boolean;
  updated_at: string | null;
};

const MAX_SESSION_ID_LENGTH = 4096;
const MAX_PROXY_LENGTH = 2048;
const MAX_SETTINGS_JSON_LENGTH = 200_000;

export function getInstagramFetchInternalSecret() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) {
    throw new Error('Supabase service role key is not configured.');
  }

  return createHash('sha256')
    .update(`${serviceRoleKey}:instagram-fetch`)
    .digest('hex');
}

function trimOptional(value: unknown) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

export async function getStoredInstagramSettings(
  supabaseAdmin: SupabaseClient,
): Promise<StoredInstagramSettings | null> {
  const { data, error } = await supabaseAdmin
    .from('instagram_settings')
    .select('id, session_id, settings_json, proxy, updated_at, updated_by')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as StoredInstagramSettings | null) ?? null;
}

export function getInstagramSettingsStatus(
  stored: StoredInstagramSettings | null,
): InstagramSettingsStatus {
  const databaseSessionConfigured = Boolean(stored?.session_id?.trim());
  const databaseSettingsConfigured = Boolean(stored?.settings_json);
  const databaseProxyConfigured = Boolean(stored?.proxy?.trim());
  const environmentFallbackConfigured = Boolean(
    process.env.INSTAGRAM_SESSION_ID?.trim()
      || process.env.session_id?.trim()
      || process.env.SESSION_ID?.trim()
      || process.env.INSTAGRAM_SETTINGS_JSON?.trim()
      || process.env.IG_SETTINGS_JSON?.trim()
      || process.env.INSTAGRAM_SETTINGS_FILE?.trim()
      || process.env.IG_SETTINGS_FILE?.trim(),
  );

  return {
    configured: databaseSessionConfigured || databaseSettingsConfigured || environmentFallbackConfigured,
    database_session_configured: databaseSessionConfigured,
    database_settings_configured: databaseSettingsConfigured,
    database_proxy_configured: databaseProxyConfigured,
    environment_fallback_configured: environmentFallbackConfigured,
    updated_at: stored?.updated_at ?? null,
  };
}

export function parseInstagramSettingsJson(value: unknown) {
  if (value === null || value === undefined || value === '') return null;

  let parsed: unknown = value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.length > MAX_SETTINGS_JSON_LENGTH) {
      throw new Error('Instagram settings JSON is too large.');
    }
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error('Instagram settings JSON must be valid JSON.');
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Instagram settings JSON must be a JSON object.');
  }

  const serialized = JSON.stringify(parsed);
  if (serialized.length > MAX_SETTINGS_JSON_LENGTH) {
    throw new Error('Instagram settings JSON is too large.');
  }

  return parsed as Record<string, unknown>;
}

export function normalizeInstagramSettingsPatch(body: Record<string, unknown>) {
  const patch: {
    session_id?: string | null;
    settings_json?: Record<string, unknown> | null;
    proxy?: string | null;
  } = {};

  if (Object.prototype.hasOwnProperty.call(body, 'session_id')) {
    const sessionId = trimOptional(body.session_id);
    if (sessionId && sessionId.length > MAX_SESSION_ID_LENGTH) {
      throw new Error('Instagram session ID is too long.');
    }
    patch.session_id = sessionId;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'settings_json')) {
    patch.settings_json = parseInstagramSettingsJson(body.settings_json);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'proxy')) {
    const proxy = trimOptional(body.proxy);
    if (proxy && proxy.length > MAX_PROXY_LENGTH) {
      throw new Error('Instagram proxy URL is too long.');
    }
    patch.proxy = proxy;
  }

  if (Object.keys(patch).length === 0) {
    throw new Error('At least one Instagram setting is required.');
  }

  return patch;
}
