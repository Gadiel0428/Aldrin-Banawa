/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import AuditViewerModule from '../../components/AuditViewerModule';

export interface AuditFeatureProps {
  isSuperAdmin: boolean;
  currentUser: string;
  currentEmployeeId: string;
}

export const AuditFeature: React.FC<AuditFeatureProps> = (props) => {
  return <AuditViewerModule {...props} />;
};
