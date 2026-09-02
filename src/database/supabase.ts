/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const metaEnv = (import.meta as any).env || {};
export const SUPABASE_URL = metaEnv.VITE_SUPABASE_URL || localStorage.getItem('juwei_wms_supabase_url') || 'https://bbzqmmlhcwwjiewdfdmq.supabase.co';
export const SUPABASE_ANON_KEY = metaEnv.VITE_SUPABASE_ANON_KEY || localStorage.getItem('juwei_wms_supabase_key') || 'sb_publishable_2U24dZnUD_Ab6RlHvVW5MA__EJlhytz';

let clientInstance: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!clientInstance) {
    const activeUrl = localStorage.getItem('juwei_wms_supabase_url') || SUPABASE_URL;
    const activeKey = localStorage.getItem('juwei_wms_supabase_key') || SUPABASE_ANON_KEY;
    
    clientInstance = createClient(activeUrl, activeKey, {
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

export function refreshSupabaseClient(newUrl?: string, newKey?: string): SupabaseClient {
  const url = newUrl || localStorage.getItem('juwei_wms_supabase_url') || SUPABASE_URL;
  const key = newKey || localStorage.getItem('juwei_wms_supabase_key') || SUPABASE_ANON_KEY;
  
  if (newUrl) localStorage.setItem('juwei_wms_supabase_url', newUrl);
  if (newKey) localStorage.setItem('juwei_wms_supabase_key', newKey);

  clientInstance = createClient(url, key, {
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
