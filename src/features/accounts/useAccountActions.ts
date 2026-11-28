/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { RegisteredAccount } from '../../types';
import { getApiBaseUrl, getAuthHeaders } from '../../config/serverConfig';
import {
  getPersistentDeviceId,
  getStationId,
  SUPER_ADMIN_ACCOUNT
} from '../../hooks/useSync';
import { showPrintToast } from '../../utils/printDocument';
import { translate } from '../../i18n';
import { resolveEffectiveMaxDevices, validateMaxDevices } from '../../../shared/deviceLimit';

export function canAccessAdminModules(
  currentPermission: string,
  currentEmployeeId: string,
  currentUser: string,
  currentRole: string
): boolean {
  return (
    currentPermission === 'FULL_ACCESS' ||
    currentEmployeeId === 'JPMP-002' ||
    (currentUser || '').toUpperCase().includes('ALDRIN') ||
    (currentRole || '').toUpperCase().includes('SUPER')
  );
}

export interface UseAccountActionsParams {
  registeredUsers: RegisteredAccount[];
  setRegisteredUsers: React.Dispatch<React.SetStateAction<RegisteredAccount[]>>;
  currentUser: string;
  currentRole: string;
  currentEmployeeId: string;
  socket: WebSocket | null;
  syncChannelRef: React.MutableRefObject<BroadcastChannel | null>;
  markRecordMutatedLocally: (id: string) => void;
  markUserAsDeleted: (employeeId: string) => void;
  unmarkUserAsDeleted: (employeeId: string) => void;
  handleDeviceRevoked: (targetDeviceId?: string) => void;
  syncCollection: (collection: string, data: any[]) => void;
  setNewlyRegisteredUser: React.Dispatch<React.SetStateAction<RegisteredAccount | null>>;
}

export function useAccountActions({
  registeredUsers,
  setRegisteredUsers,
  currentUser,
  currentRole,
  currentEmployeeId,
  socket,
  syncChannelRef,
  markRecordMutatedLocally,
  markUserAsDeleted,
  unmarkUserAsDeleted,
  handleDeviceRevoked,
  syncCollection,
  setNewlyRegisteredUser
}: UseAccountActionsParams) {
  const handleRegister = (
    username: string,
    role: string,
    employeeId: string,
    permission?: string,
    phoneNumber?: string,
    customPin?: string,
    status?: 'ACTIVE' | 'PENDING' | 'INACTIVE',
    maxDevices?: number
  ): RegisteredAccount | null => {
    const isSuperAdminOperating =
      currentEmployeeId === 'JPMP-002' ||
      (currentUser || '').toUpperCase().includes('ALDRIN') ||
      currentRole === 'SUPER ADMINISTRATOR';

    if (!isSuperAdminOperating) {
      showPrintToast(translate('accounts.adminOnlyRegister'), 'error');
      return null;
    }

    const cleanUsername = (username || '').trim().toUpperCase();
    let cleanEmployeeId = (employeeId || '').trim().toUpperCase();
    if (cleanEmployeeId && !cleanEmployeeId.startsWith('JPMP-')) {
      const strippedId = cleanEmployeeId.replace(/^EMP-/, '');
      cleanEmployeeId = `JPMP-${strippedId}`;
    }
    const cleanRole = (role || '').toUpperCase();
    if (!cleanUsername || !cleanRole || !cleanEmployeeId) {
      showPrintToast(translate('accounts.allFieldsRequired'), 'warning');
      return null;
    }
    const exists = registeredUsers.some(
      u => (u.employeeId || '').toUpperCase() === cleanEmployeeId ||
           (u.username || '').toUpperCase() === cleanUsername
    );
    if (exists) {
      showPrintToast(translate('accounts.duplicateAccount'), 'warning');
      return null;
    }

    let finalPin = '';
    const cleanProvidedPin = customPin ? customPin.replace(/\D/g, '').slice(0, 4) : '';
    if (cleanProvidedPin.length === 4 && cleanProvidedPin !== '1234' && !/^(\d)\1+$/.test(cleanProvidedPin)) {
      finalPin = cleanProvidedPin;
    } else {
      let attempts = 0;
      while (attempts < 200) {
        let num = 1000 + Math.floor(Math.random() * 9000);
        if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
          const arr = new Uint32Array(1);
          crypto.getRandomValues(arr);
          num = 1000 + (arr[0] % 9000);
        }
        const pinCandidate = String(num);
        if (pinCandidate !== '1234' && !/^(\d)\1+$/.test(pinCandidate)) {
          finalPin = pinCandidate;
          break;
        }
        attempts++;
      }
      if (!finalPin) {
        finalPin = '4917';
      }
    }

    const maxDevCheck = validateMaxDevices(maxDevices, { defaultIfEmpty: true });
    if (!maxDevCheck.valid) {
      showPrintToast(maxDevCheck.error || translate('accounts.maxDevicesRangeError'), 'warning');
      return null;
    }

    const cleanPermission = permission || (cleanEmployeeId === 'JPMP-002' ? 'FULL_ACCESS' : 'LIMITED_ACCESS');
    const newUserWithOneTimePin: RegisteredAccount = {
      username: cleanUsername,
      role: cleanRole,
      employeeId: cleanEmployeeId,
      phoneNumber: phoneNumber ? phoneNumber.trim() : '',
      permission: cleanPermission,
      maxDevices: maxDevCheck.value,
      pin: finalPin,
      hasPin: true,
      status: status || 'ACTIVE',
      registeredBy: 'JPMP-002 (ALDRIN BANAWA)',
      registeredBySuperAdmin: true,
      registeredAt: new Date().toISOString(),
      stationId: getStationId()
    };
    const { pin: _omittedPin, ...sanitizedNewUser } = newUserWithOneTimePin;

    unmarkUserAsDeleted(cleanEmployeeId);
    markRecordMutatedLocally(cleanEmployeeId);

    const nextUsers = [...registeredUsers.filter(u => (u.employeeId || '').toUpperCase() !== cleanEmployeeId), sanitizedNewUser];
    setRegisteredUsers(nextUsers);

    if (syncChannelRef.current) {
      try {
        syncChannelRef.current.postMessage({
          type: 'account_registered',
          user: sanitizedNewUser,
          author: currentUser || 'Super Administrator'
        });
      } catch (e) {}
    }

    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({
          type: 'register_account',
          user: newUserWithOneTimePin,
          device_id: getPersistentDeviceId(),
          author: currentUser || 'Super Administrator (Aldrin Banawa)',
          requesterEmployeeId: currentEmployeeId || 'JPMP-002'
        }));
      } catch (e) {
        console.warn('WS send register_account error:', e);
      }
    }

    try {
      const baseUrl = getApiBaseUrl();
      const persistentDevId = getPersistentDeviceId();
      fetch(`${baseUrl}/api/accounts/register`, {
        method: 'POST',
        headers: getAuthHeaders({
          'Content-Type': 'application/json',
          'x-device-id': persistentDevId
        }),
        body: JSON.stringify({
          ...newUserWithOneTimePin,
          device_id: persistentDevId,
          requesterEmployeeId: currentEmployeeId || 'JPMP-002',
          requesterUsername: currentUser || 'ALDRIN BANAWA',
          author: currentUser || 'ALDRIN BANAWA'
        })
      }).then(async (res) => {
        if (res.status === 403) {
          const errJson = await res.json().catch(() => ({}));
          if (errJson?.error === 'DEVICE_REVOKED') {
            handleDeviceRevoked(persistentDevId);
          }
        } else if (res.status === 400) {
          const errJson = await res.json().catch(() => ({}));
          if (errJson?.error) {
            showPrintToast(errJson.error, 'error');
          }
        }
      }).catch(() => {});
    } catch (e) {}

    setNewlyRegisteredUser(newUserWithOneTimePin);
    return newUserWithOneTimePin;
  };

  const handleRemoveUser = (employeeId: string) => {
    const cleanId = (employeeId || '').trim().toUpperCase();
    if (!cleanId) return;
    const targetUser = registeredUsers.find(u => (u.employeeId || '').toUpperCase() === cleanId);
    const isAldrin = cleanId === 'JPMP-002' || cleanId.endsWith('-002') || (targetUser && (
      (targetUser.username || '').toUpperCase().includes('ALDRIN BANAWA') ||
      (targetUser.username || '').toUpperCase() === 'SUPER ADMIN'
    ));

    if (isAldrin) {
      showPrintToast(translate('accounts.cannotDeleteRoot'), 'error');
      return;
    }

    markUserAsDeleted(cleanId);

    const nextUsers = registeredUsers.filter(u => (u.employeeId || '').toUpperCase() !== cleanId);
    setRegisteredUsers(nextUsers);

    if (syncChannelRef.current) {
      try {
        syncChannelRef.current.postMessage({
          type: 'delete_account',
          employeeId: cleanId
        });
      } catch (e) {}
    }

    const baseUrl = getApiBaseUrl();
    const persistentDevId = getPersistentDeviceId();
    fetch(`${baseUrl}/api/accounts/delete`, {
      method: 'POST',
      headers: getAuthHeaders({
        'Content-Type': 'application/json',
        'x-device-id': persistentDevId
      }),
      body: JSON.stringify({ employeeId: cleanId, device_id: persistentDevId })
    }).then(async (res) => {
      if (res.status === 403) {
        const errJson = await res.json().catch(() => ({}));
        if (errJson?.error === 'DEVICE_REVOKED') {
          handleDeviceRevoked(persistentDevId);
        }
      }
    }).catch(() => {});

    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({
          type: 'delete_account',
          employeeId: cleanId,
          device_id: persistentDevId
        }));
      } catch (e) {
        console.warn('WS send delete error:', e);
      }
    }
  };

  const handleClearAllAccountsExceptSuperAdmin = () => {
    const onlySuperAdmin = [SUPER_ADMIN_ACCOUNT];
    setRegisteredUsers(onlySuperAdmin);

    if (syncChannelRef.current) {
      try {
        syncChannelRef.current.postMessage({
          type: 'all_accounts_cleared'
        });
      } catch (e) {}
    }

    const baseUrl = getApiBaseUrl();
    const persistentDevId = getPersistentDeviceId();
    fetch(`${baseUrl}/api/accounts/clear-all-except-super-admin`, {
      method: 'POST',
      headers: getAuthHeaders({
        'Content-Type': 'application/json',
        'x-device-id': persistentDevId
      }),
      body: JSON.stringify({ device_id: persistentDevId })
    }).then(async (res) => {
      if (res.status === 403) {
        const errJson = await res.json().catch(() => ({}));
        if (errJson?.error === 'DEVICE_REVOKED') {
          handleDeviceRevoked(persistentDevId);
        }
      }
    }).catch(() => {});

    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({
          type: 'all_accounts_cleared',
          device_id: persistentDevId,
          data: onlySuperAdmin
        }));
      } catch (e) {}
    }
  };

  const handleUpdateAccount = (oldEmpId: string, updated: RegisteredAccount) => {
    const cleanOldId = (oldEmpId || '').toUpperCase();
    let cleanNewId = (updated.employeeId || '').trim().toUpperCase();
    if (cleanNewId && !cleanNewId.startsWith('JPMP-')) {
      const strippedId = cleanNewId.replace(/^EMP-/, '');
      cleanNewId = `JPMP-${strippedId}`;
    }
    if (cleanOldId === 'JPMP-002') {
      cleanNewId = 'JPMP-002';
    }

    if (cleanNewId !== cleanOldId && registeredUsers.some(u => (u.employeeId || '').toUpperCase() === cleanNewId)) {
      showPrintToast(translate('accounts.duplicateEmpId', { id: cleanNewId }), 'warning');
      return;
    }

    const nextUsers = registeredUsers.map(u => {
      if ((u.employeeId || '').toUpperCase() === cleanOldId) {
        const { pin: _dropIncomingPin, ...restUpdated } = updated;
        const { pin: _dropExistingPin, ...restExisting } = u;
        const resolvedMaxDevices =
          updated.maxDevices !== undefined
            ? validateMaxDevices(updated.maxDevices, { defaultIfEmpty: true }).value
            : resolveEffectiveMaxDevices(u);
        return {
          ...restExisting,
          ...restUpdated,
          employeeId: cleanNewId,
          username: (updated.username || '').toUpperCase(),
          role: (updated.role || '').toUpperCase(),
          phoneNumber: updated.phoneNumber !== undefined ? updated.phoneNumber : (u.phoneNumber || ''),
          permission: updated.permission || u.permission || 'LIMITED_ACCESS',
          maxDevices: resolvedMaxDevices,
          hasPin: Boolean(updated.hasPin ?? u.hasPin ?? true),
          mustChangePin: updated.mustChangePin !== undefined ? updated.mustChangePin : u.mustChangePin,
          isPinCompromised: updated.isPinCompromised !== undefined ? updated.isPinCompromised : u.isPinCompromised,
          status: updated.status || u.status || 'ACTIVE',
          lastActive: updated.lastActive !== undefined ? updated.lastActive : u.lastActive
        };
      }
      return u;
    });

    const targetUpdatedUser = nextUsers.find(u => (u.employeeId || '').toUpperCase() === cleanNewId);
    const persistentDevId = getPersistentDeviceId();

    if (cleanNewId !== cleanOldId) {
      unmarkUserAsDeleted(cleanNewId);
      const baseUrl = getApiBaseUrl();
      fetch(`${baseUrl}/api/accounts/delete`, {
        method: 'POST',
        headers: getAuthHeaders({
          'Content-Type': 'application/json',
          'x-device-id': persistentDevId
        }),
        body: JSON.stringify({ employeeId: cleanOldId, device_id: persistentDevId })
      }).catch(() => {});
    }

    setRegisteredUsers(nextUsers);
    localStorage.setItem('juwei_wms_registeredUsers', JSON.stringify(nextUsers));

    if (syncChannelRef.current && targetUpdatedUser) {
      try {
        syncChannelRef.current.postMessage({
          type: 'account_updated',
          user: targetUpdatedUser,
          author: currentUser || 'Admin'
        });
      } catch (e) {}
    }

    if (socket && socket.readyState === WebSocket.OPEN && targetUpdatedUser) {
      try {
        socket.send(JSON.stringify({
          type: 'update_account',
          oldEmployeeId: cleanOldId,
          user: targetUpdatedUser,
          device_id: persistentDevId,
          author: currentUser || 'Admin'
        }));
      } catch (e) {
        console.warn('WS send update_account error:', e);
      }
    }

    if (targetUpdatedUser) {
      try {
        const baseUrl = getApiBaseUrl();
        fetch(`${baseUrl}/api/accounts/update`, {
          method: 'POST',
          headers: getAuthHeaders({
            'Content-Type': 'application/json',
            'x-device-id': persistentDevId
          }),
          body: JSON.stringify({
            oldEmployeeId: cleanOldId,
            updatedUser: targetUpdatedUser,
            device_id: persistentDevId
          })
        }).then(async (res) => {
          if (res.status === 403) {
            const errJson = await res.json().catch(() => ({}));
            if (errJson?.error === 'DEVICE_REVOKED') {
              handleDeviceRevoked(persistentDevId);
            }
          } else if (res.status === 400) {
            const errJson = await res.json().catch(() => ({}));
            if (errJson?.error) {
              showPrintToast(errJson.error, 'error');
            }
          }
        }).catch(() => {});
      } catch (e) {}
    }

    syncCollection('registeredUsers', nextUsers);
  };

  return {
    handleRegister,
    handleRemoveUser,
    handleClearAllAccountsExceptSuperAdmin,
    handleUpdateAccount
  };
}
