/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import BarcodeScannerModal from '../../components/BarcodeScannerModal';
import QuickRecordLookupModal from '../../components/QuickRecordLookupModal';
import { useI18n } from '../../i18n';
import {
  MaterialStockItem,
  ReceivingRecord,
  IssuanceRecord,
  DeliveryRecord,
  ReturnRecord,
  RecyclingRecord,
  MasterRegistryItem
} from '../../types';

export interface QuickLookupModalsProps {
  showScanner: boolean;
  onCloseScanner: () => void;
  onScanResult: (scannedCode: string) => void;
  showResults: boolean;
  onCloseResults: () => void;
  onOpenScannerFromResults: () => void;
  searchTerm: string;
  onSearchTermChange: (val: string) => void;
  stocks: MaterialStockItem[];
  receiving: ReceivingRecord[];
  issuances: IssuanceRecord[];
  deliveries: DeliveryRecord[];
  returns: ReturnRecord[];
  recycling: RecyclingRecord[];
  registries: MasterRegistryItem[];
  onNavigateToModule: (moduleView: string, filterQuery?: string) => void;
}

export const QuickLookupModals: React.FC<QuickLookupModalsProps> = ({
  showScanner,
  onCloseScanner,
  onScanResult,
  showResults,
  onCloseResults,
  onOpenScannerFromResults,
  searchTerm,
  onSearchTermChange,
  stocks,
  receiving,
  issuances,
  deliveries,
  returns,
  recycling,
  registries,
  onNavigateToModule
}) => {
  const { t } = useI18n();

  return (
    <>
      {showScanner && (
        <BarcodeScannerModal
          isOpen={showScanner}
          onClose={onCloseScanner}
          title={t('modals.quickLookup.scannerTitle')}
          subtitle={t('modals.quickLookup.scannerSubtitle')}
          onScanResult={onScanResult}
        />
      )}

      {showResults && (
        <QuickRecordLookupModal
          isOpen={showResults}
          onClose={onCloseResults}
          onOpenScanner={onOpenScannerFromResults}
          searchTerm={searchTerm}
          onSearchTermChange={onSearchTermChange}
          stocks={stocks}
          receiving={receiving}
          issuances={issuances}
          deliveries={deliveries}
          returns={returns}
          recycling={recycling}
          registries={registries}
          onNavigateToModule={onNavigateToModule}
        />
      )}
    </>
  );
};
