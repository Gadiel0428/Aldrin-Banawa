/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import ReceivingModule from '../../components/ReceivingModule';
import {
  ReceivingRecord,
  ReturnRecord,
  MaterialStockItem,
  MasterRegistryItem,
  FifoColorsMap
} from '../../types';

export interface ReceivingFeatureProps {
  receiving: ReceivingRecord[];
  onAddReceiving: (record: ReceivingRecord) => void;
  onUpdateIqc: (id: string, iqcStatus: ReceivingRecord['iqcStatus']) => void;
  onEditReceiving: (record: ReceivingRecord) => void;
  onDeleteReceiving: (id: string) => void;
  returns: ReturnRecord[];
  onAddReturn: (record: ReturnRecord) => void;
  onUpdateReturnStatus: (id: string, status: ReturnRecord['status']) => void;
  onEditReturn: (record: ReturnRecord) => void;
  onDeleteReturn: (id: string) => void;
  stocks: MaterialStockItem[];
  registries: MasterRegistryItem[];
  isSuperAdmin: boolean;
  canEdit: boolean;
  onOpenRegisterModal: () => void;
  receivingCategories: string[];
  onUpdateReceivingCategories: (newCategories: string[], renameData?: { oldCat: string; newCat: string }) => void;
  fifoColorsByMonth: FifoColorsMap;
}

export const ReceivingFeature: React.FC<ReceivingFeatureProps> = (props) => {
  return <ReceivingModule {...props} />;
};
