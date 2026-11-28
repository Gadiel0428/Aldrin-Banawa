/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import StockFIFOControl from '../../components/StockFIFOControl';
import { StockMovementView } from '../../components/StockMovement';
import { ProductList } from '../../components/ProductList';
import { InventoryTable } from '../../components/InventoryTable';
import {
  MaterialStockItem,
  ReceivingRecord,
  IssuanceRecord,
  ReturnRecord,
  MasterRegistryItem,
  FifoColorsMap,
  FifoMonthColor
} from '../../types';

export interface StockFeatureProps {
  stocks: MaterialStockItem[];
  onAddStock: (item: MaterialStockItem) => void;
  onUpdateStockQty: (id: string, qty: number) => void;
  onUpdateStockStatus: (id: string, status: MaterialStockItem['status']) => void;
  onEditStock: (item: MaterialStockItem) => void;
  onDeleteStock: (id: string) => void;
  isSuperAdmin: boolean;
  canEdit: boolean;
  receiving: ReceivingRecord[];
  issuances: IssuanceRecord[];
  returns: ReturnRecord[];
  registries: MasterRegistryItem[];
  fifoColorsByMonth: FifoColorsMap;
  onUpdateFifoColors: (updated: FifoColorsMap | { month: number; color: FifoMonthColor }) => void;
  currentUser?: { id: string; name: string; username: string };
  onStockUpdated?: () => void;
  initialTab?: 'bins' | 'movements';
}

export const StockFeature: React.FC<StockFeatureProps> = (props) => {
  return <StockFIFOControl {...props} />;
};

export interface StockMovementsFeatureProps {
  stocks: MaterialStockItem[];
  currentUser: { id: string; name: string; username: string };
  onStockUpdated: () => void;
}

export const StockMovementsFeature: React.FC<StockMovementsFeatureProps> = (props) => {
  return <StockMovementView {...props} />;
};

export const ProductsFeature: React.FC = () => {
  return <ProductList />;
};

export const InventoryMatrixFeature: React.FC = () => {
  return <InventoryTable />;
};
