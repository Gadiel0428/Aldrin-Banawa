/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import DeliveryModule from '../../components/DeliveryModule';
import { DeliveryRecord, ForkliftChecklist, MaterialStockItem, MasterRegistryItem } from '../../types';

export interface DeliveryFeatureProps {
  deliveries: DeliveryRecord[];
  forkliftChecks: ForkliftChecklist[];
  onAddDelivery: (record: DeliveryRecord) => void;
  onAddForkliftCheck: (check: ForkliftChecklist) => void;
  onUpdateDeliveryStatus: (id: string, status: DeliveryRecord['status'], extDoc?: { drNumber?: string; salesInvoice?: string; wayBill?: string }) => void;
  onEditDelivery: (record: DeliveryRecord) => void;
  onDeleteDelivery: (id: string) => void;
  stocks: MaterialStockItem[];
  registries: MasterRegistryItem[];
  currentUser: string;
  isSuperAdmin: boolean;
  canEdit: boolean;
}

export const DeliveryFeature: React.FC<DeliveryFeatureProps> = (props) => {
  return <DeliveryModule {...props} />;
};
