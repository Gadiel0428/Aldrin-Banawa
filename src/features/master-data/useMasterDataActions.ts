/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { MasterRegistryItem } from '../../types';
import { DEFAULT_MASTER_REGISTRIES } from '../../components/MasterRegistryModule';

export interface UseMasterDataActionsParams {
  registries: MasterRegistryItem[];
  setRegistries: React.Dispatch<React.SetStateAction<MasterRegistryItem[]>>;
  upsertRecordLocallyAndRemotely: (
    collection: string,
    record: any,
    actionDesc?: string,
    options?: { overrideExpectedVersion?: number; existingMutationId?: string }
  ) => void;
  deleteRecordLocallyAndRemotely: (
    collection: string,
    id: string,
    options?: { overrideExpectedVersion?: number; existingMutationId?: string }
  ) => void;
  syncCollection: (collection: string, data: any[]) => void;
}

export function useMasterDataActions({
  registries,
  setRegistries,
  upsertRecordLocallyAndRemotely,
  deleteRecordLocallyAndRemotely,
  syncCollection
}: UseMasterDataActionsParams) {
  const handleRegisterMasterItem = (item: MasterRegistryItem) => {
    const next = [item, ...registries];
    setRegistries(next);
    upsertRecordLocallyAndRemotely('registries', item, `Registered master item ${item.name} (${item.code})`);
  };

  const handleUpdateMasterItem = (item: MasterRegistryItem) => {
    const next = registries.map(r => r.id === item.id ? item : r);
    setRegistries(next);
    upsertRecordLocallyAndRemotely('registries', item, `Updated master item ${item.name} (${item.code})`);
  };

  const handleDeleteMasterItem = (id: string) => {
    deleteRecordLocallyAndRemotely('registries', id);
    const next = registries.filter(r => r.id !== id);
    setRegistries(next);
  };

  const handleResetMasterDefaults = () => {
    setRegistries(DEFAULT_MASTER_REGISTRIES);
    syncCollection('registries', DEFAULT_MASTER_REGISTRIES);
  };

  return {
    handleRegisterMasterItem,
    handleUpdateMasterItem,
    handleDeleteMasterItem,
    handleResetMasterDefaults
  };
}
