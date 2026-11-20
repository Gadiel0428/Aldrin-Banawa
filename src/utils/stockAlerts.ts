import { MaterialStockItem, getCustomerForPart } from '../types';

export interface LowStockAlertSku {
  partCode: string;
  description: string;
  type: string;
  location: string;
  unit: string;
  currentQty: number;
  reorderMin: number;
  shortage: number;
  customer: string;
}

export interface ShelfLifeAlertLot {
  item: MaterialStockItem;
  expirationDate: string;
  diffDays: number;
  isExpired: boolean;
}

export interface UnifiedStockAlertItem {
  key: string;
  partCode: string;
  description: string;
  location: string;
  lotNumber?: string;
  unit: string;
  customer: string;
  status?: MaterialStockItem['status'];
  quantity?: number;
  isLowStock: boolean;
  currentQty?: number;
  reorderMin?: number;
  shortage?: number;
  isExpiring: boolean;
  expirationDate?: string;
  diffDays?: number;
  isExpired?: boolean;
}

export interface StockAlertsSummary {
  todayStr: string;
  lowStockSkus: LowStockAlertSku[];
  nearExpiryItems: ShelfLifeAlertLot[];
  unifiedAlerts: UnifiedStockAlertItem[];
  totalCount: number;
  lowStockCount: number;
  shelfLifeCount: number;
}

function parseIsoDayUtcMs(dateStr: string): number {
  const trimmed = (dateStr || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return new Date(`${trimmed}T00:00:00Z`).getTime();
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return Number.NaN;
  const isoDay = parsed.toISOString().split('T')[0];
  return new Date(`${isoDay}T00:00:00Z`).getTime();
}

export function computeStockAlerts(
  stocks: MaterialStockItem[],
  referenceDateStr?: string
): StockAlertsSummary {
  const todayStr = referenceDateStr || new Date().toISOString().split('T')[0];
  const todayMs = parseIsoDayUtcMs(todayStr);

  // 1. Aggregate approved quantities and max defined reorderMin per partCode
  const stockQtyByPart: Record<string, number> = {};
  const reorderMinByPart: Record<string, number> = {};

  for (const item of stocks) {
    const qty = Number(item.quantity) || 0;
    if (item.status === 'APPROVED') {
      stockQtyByPart[item.partCode] = (stockQtyByPart[item.partCode] || 0) + qty;
    }
    if (typeof item.reorderMin === 'number' && item.reorderMin > 0) {
      reorderMinByPart[item.partCode] = Math.max(reorderMinByPart[item.partCode] || 0, item.reorderMin);
    }
  }

  const lowStockMap: Record<string, LowStockAlertSku> = {};
  for (const item of stocks) {
    const minThreshold =
      typeof item.reorderMin === 'number' && item.reorderMin > 0
        ? item.reorderMin
        : reorderMinByPart[item.partCode];

    if (typeof minThreshold === 'number' && minThreshold > 0) {
      const currentQty = stockQtyByPart[item.partCode] ?? 0;
      if (currentQty <= minThreshold && !lowStockMap[item.partCode]) {
        lowStockMap[item.partCode] = {
          partCode: item.partCode,
          description: item.description,
          type: item.type,
          location: item.location,
          unit: item.unit || 'PCS',
          currentQty,
          reorderMin: minThreshold,
          shortage: Math.max(0, minThreshold - currentQty),
          customer: item.customer || getCustomerForPart(item.partCode, item.description)
        };
      }
    }
  }

  const lowStockSkus = Object.values(lowStockMap).sort((a, b) => {
    const ratioA = a.reorderMin > 0 ? a.currentQty / a.reorderMin : 1;
    const ratioB = b.reorderMin > 0 ? b.currentQty / b.reorderMin : 1;
    return ratioA - ratioB;
  });

  // 2. Identify lots expiring within 30 days (including already expired)
  const nearExpiryItems: ShelfLifeAlertLot[] = [];
  for (const item of stocks) {
    if (!item.expirationDate) continue;
    const expMs = parseIsoDayUtcMs(item.expirationDate);
    if (Number.isNaN(expMs) || Number.isNaN(todayMs)) continue;
    const diffDays = Math.ceil((expMs - todayMs) / (1000 * 60 * 60 * 24));
    if (diffDays <= 30) {
      nearExpiryItems.push({
        item,
        expirationDate: item.expirationDate,
        diffDays,
        isExpired: diffDays <= 0
      });
    }
  }

  nearExpiryItems.sort((a, b) => a.diffDays - b.diffDays);

  // 3. Build unified deduplicated alert list
  const unifiedAlerts: UnifiedStockAlertItem[] = [];
  const coveredLowStockParts = new Set<string>();

  nearExpiryItems.forEach((lotAlert, idx) => {
    const { item, expirationDate, diffDays, isExpired } = lotAlert;
    const lowSku = lowStockMap[item.partCode];
    const attachLowStock = Boolean(lowSku) && !coveredLowStockParts.has(item.partCode);
    if (attachLowStock) {
      coveredLowStockParts.add(item.partCode);
    }

    unifiedAlerts.push({
      key: item.id ? `exp-${item.id}` : `exp-${item.partCode}-${item.lotNumber || idx}`,
      partCode: item.partCode,
      description: item.description,
      location: item.location,
      lotNumber: item.lotNumber,
      unit: item.unit || 'PCS',
      customer: item.customer || getCustomerForPart(item.partCode, item.description),
      status: item.status,
      quantity: Number(item.quantity) || 0,
      isLowStock: attachLowStock,
      currentQty: attachLowStock ? lowSku.currentQty : undefined,
      reorderMin: attachLowStock ? lowSku.reorderMin : undefined,
      shortage: attachLowStock ? lowSku.shortage : undefined,
      isExpiring: true,
      expirationDate,
      diffDays,
      isExpired
    });
  });

  for (const sku of lowStockSkus) {
    if (coveredLowStockParts.has(sku.partCode)) continue;
    unifiedAlerts.push({
      key: `low-${sku.partCode}`,
      partCode: sku.partCode,
      description: sku.description,
      location: sku.location,
      unit: sku.unit,
      customer: sku.customer,
      isLowStock: true,
      currentQty: sku.currentQty,
      reorderMin: sku.reorderMin,
      shortage: sku.shortage,
      isExpiring: false
    });
  }

  return {
    todayStr,
    lowStockSkus,
    nearExpiryItems,
    unifiedAlerts,
    totalCount: unifiedAlerts.length,
    lowStockCount: lowStockSkus.length,
    shelfLifeCount: nearExpiryItems.length
  };
}
