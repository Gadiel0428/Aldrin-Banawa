/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://bbzqmmlhcwwjiewdfdmq.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_2U24dZnUD_Ab6RlHvVW5MA__EJlhytz';

let clientInstance: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!clientInstance) {
    clientInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
      realtime: {
        params: {
          eventsPerSecond: 20,
        },
      },
    });
  }
  return clientInstance;
}

export const supabase = getSupabaseClient();

export function refreshSupabaseClient(): SupabaseClient {
  clientInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
    realtime: {
      params: {
        eventsPerSecond: 20,
      },
    },
  });

  return clientInstance;
}
