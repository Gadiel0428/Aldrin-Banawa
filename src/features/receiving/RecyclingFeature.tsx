/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import RecyclingModule from '../../components/RecyclingModule';
import { RecyclingRecord, MasterRegistryItem } from '../../types';

export interface RecyclingFeatureProps {
  recycling: RecyclingRecord[];
  onAddRecycling: (record: RecyclingRecord) => void;
  onDeleteRecycling: (id: string) => void;
  isSuperAdmin: boolean;
  canEdit: boolean;
  registries?: MasterRegistryItem[];
}

export const RecyclingFeature: React.FC<RecyclingFeatureProps> = (props) => {
  return <RecyclingModule {...props} />;
};
