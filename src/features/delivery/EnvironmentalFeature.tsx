/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import EnvironmentalModule from '../../components/EnvironmentalModule';
import { EnvironmentalLog, MasterRegistryItem } from '../../types';

export interface EnvironmentalFeatureProps {
  envLogs: EnvironmentalLog[];
  onAddEnvLog: (log: EnvironmentalLog) => void;
  onClearEnvLogs: () => void;
  onDeleteEnvLog: (id: string) => void;
  registries: MasterRegistryItem[];
  onRegisterLocation: (item: MasterRegistryItem) => void;
  onUpdateLocation: (id: string, data: Partial<MasterRegistryItem>) => void;
  onDeleteLocation: (id: string) => void;
  currentUserRole: string;
  currentUser: string;
  isSuperAdmin: boolean;
  canEdit: boolean;
}

export const EnvironmentalFeature: React.FC<EnvironmentalFeatureProps> = (props) => {
  return <EnvironmentalModule {...props} />;
};
