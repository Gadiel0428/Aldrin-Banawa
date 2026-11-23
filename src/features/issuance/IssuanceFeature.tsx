/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import IssuanceModule from '../../components/IssuanceModule';
import { IssuanceRecord, MaterialStockItem, MasterRegistryItem } from '../../types';

export interface IssuanceFeatureProps {
  stocks: MaterialStockItem[];
  issuances: IssuanceRecord[];
  onAddIssuance: (record: IssuanceRecord) => void;
  onDeductStock: (partCode: string, lotNumber: string, quantity: number) => boolean;
  onEditIssuance: (record: IssuanceRecord) => void;
  onDeleteIssuance: (id: string) => void;
  registries: MasterRegistryItem[];
  currentUser: string;
  isSuperAdmin: boolean;
  canEdit: boolean;
}

export const IssuanceFeature: React.FC<IssuanceFeatureProps> = (props) => {
  return <IssuanceModule {...props} />;
};
