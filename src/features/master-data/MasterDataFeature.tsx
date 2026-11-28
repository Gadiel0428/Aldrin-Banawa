/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import MasterRegistryModule from '../../components/MasterRegistryModule';
import { MasterRegistryItem, RegistryType } from '../../types';

export interface MasterDataFeatureProps {
  registries: MasterRegistryItem[];
  onRegisterItem: (item: MasterRegistryItem) => void;
  onUpdateItem: (item: MasterRegistryItem) => void;
  onDeleteItem: (id: string) => void;
  onResetDefaults: () => void;
  isSuperAdmin: boolean;
  canEdit: boolean;
  defaultType?: RegistryType | 'ALL';
  defaultView?: 'registry' | 'products';
}

export const MasterDataFeature: React.FC<MasterDataFeatureProps> = (props) => {
  return <MasterRegistryModule {...props} />;
};
