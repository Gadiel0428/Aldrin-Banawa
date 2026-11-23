/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import DashboardOverview from '../../components/DashboardOverview';
import {
  MaterialStockItem,
  ReceivingRecord,
  IssuanceRecord,
  DeliveryRecord,
  RecyclingRecord,
  EnvironmentalLog,
  ForkliftChecklist,
  RegisteredAccount,
  MasterRegistryItem,
  ChatMessage
} from '../../types';

export interface DashboardFeatureProps {
  stocks: MaterialStockItem[];
  receiving: ReceivingRecord[];
  issuances: IssuanceRecord[];
  deliveries: DeliveryRecord[];
  recycling: RecyclingRecord[];
  envLogs: EnvironmentalLog[];
  forkliftChecks: ForkliftChecklist[];
  setView: (view: string) => void;
  activeUsers: string[];
  chatMessages: ChatMessage[];
  currentUser: string;
  sendChatMessage: (text: string) => void;
  registeredUsers: RegisteredAccount[];
  isSuperAdmin: boolean;
  canEdit: boolean;
  registries: MasterRegistryItem[];
  openAlertsSignal: number;
}

export const DashboardFeature: React.FC<DashboardFeatureProps> = ({
  stocks,
  receiving,
  issuances,
  deliveries,
  recycling,
  envLogs,
  forkliftChecks,
  setView,
  activeUsers,
  chatMessages,
  currentUser,
  sendChatMessage,
  registeredUsers,
  isSuperAdmin,
  canEdit,
  registries,
  openAlertsSignal
}) => {
  return (
    <DashboardOverview
      stocks={stocks}
      receiving={receiving}
      issuances={issuances}
      deliveries={deliveries}
      recycling={recycling}
      envLogs={envLogs}
      forkliftChecks={forkliftChecks}
      setView={setView}
      activeUsers={activeUsers}
      chatMessages={chatMessages}
      currentUser={currentUser}
      sendChatMessage={sendChatMessage}
      registeredUsers={registeredUsers}
      isSuperAdmin={isSuperAdmin}
      canEdit={canEdit}
      registries={registries}
      openAlertsSignal={openAlertsSignal}
    />
  );
};
