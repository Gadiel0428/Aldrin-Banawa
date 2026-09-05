/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase, DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_ANON_KEY } from '../lib/supabase';

export const SUPABASE_URL = DEFAULT_SUPABASE_URL;
export const SUPABASE_ANON_KEY = DEFAULT_SUPABASE_ANON_KEY;

export function getSupabaseClient(): SupabaseClient {
  const client = getSupabase();
  if (!client) {
    throw new Error('Supabase client failed to initialize with current configuration');
  }
  return client;
}

export const supabase = getSupabaseClient();

export function refreshSupabaseClient(): SupabaseClient {
  return getSupabaseClient();
}

