/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import RegisteredAccountsModule from '../../components/RegisteredAccountsModule';
import { RegisteredAccount } from '../../types';

export interface AccountsFeatureProps {
  accounts: RegisteredAccount[];
  operationalRoles: string[];
  onUpdateOperationalRoles: (roles: string[]) => void;
  onAddAccount: (
    username: string,
    role: string,
    employeeId: string,
    permission?: string,
    phoneNumber?: string,
    customPin?: string,
    status?: 'ACTIVE' | 'PENDING' | 'INACTIVE',
    maxDevices?: number
  ) => RegisteredAccount | null;
  onUpdateAccount: (oldEmployeeId: string, updated: RegisteredAccount) => void;
  onRemoveAccount: (employeeId: string) => void;
  onClearAllAccounts: () => void;
  onOpenBackups: () => void;
  currentUser: string;
  currentEmployeeId: string;
  isSuperAdmin: boolean;
  canEdit: boolean;
}

export const AccountsFeature: React.FC<AccountsFeatureProps> = (props) => {
  return <RegisteredAccountsModule {...props} />;
};
