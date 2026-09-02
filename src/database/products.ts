/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { getSupabaseClient } from './supabase';
import { Product, ProductFilter } from '../types/product';

export async function fetchProducts(filter?: ProductFilter): Promise<Product[]> {
  const client = getSupabaseClient();
  let query = client.from('products').select('*').order('name', { ascending: true });

  if (filter?.search) {
    query = query.or(`name.ilike.%${filter.search}%,sku.ilike.%${filter.search}%,barcode.ilike.%${filter.search}%`);
  }
  if (filter?.category) {
    query = query.eq('category', filter.category);
  }
  if (filter?.type) {
    query = query.eq('type', filter.type);
  }
  if (filter?.isActive !== undefined) {
    query = query.eq('is_active', filter.isActive);
  }

  const { data, error } = await query;
  if (error) {
    console.warn('Error fetching products from Supabase:', error.message);
    return [];
  }
  return (data as Product[]) || [];
}

export async function getProductBySku(sku: string): Promise<Product | null> {
  const client = getSupabaseClient();
  const { data, error } = await client.from('products').select('*').eq('sku', sku).single();
  if (error || !data) return null;
  return data as Product;
}

export async function upsertProduct(product: Partial<Product>): Promise<Product | null> {
  const client = getSupabaseClient();
  const payload = {
    ...product,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await client
    .from('products')
    .upsert(payload, { onConflict: 'sku' })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to upsert product: ${error.message}`);
  }
  return data as Product;
}
