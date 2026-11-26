/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { encodeCode128B } from '../utils/barcode128';

export interface Code128BarcodeProps {
  value: string;
  height?: number;
  barWidth?: number;
  showText?: boolean;
  className?: string;
}

export const Code128Barcode: React.FC<Code128BarcodeProps> = ({
  value,
  height = 52,
  barWidth = 2,
  showText = true,
  className = '',
}) => {
  const encoded = useMemo(() => {
    try {
      return encodeCode128B(value, 10);
    } catch {
      return null;
    }
  }, [value]);

  if (!encoded) {
    return (
      <div className={`text-[10px] font-mono text-rose-700 border border-rose-300 px-2 py-1 ${className}`}>
        INVALID BARCODE
      </div>
    );
  }

  const svgWidth = Math.round(encoded.totalModules * barWidth);

  return (
    <div className={`inline-flex flex-col items-center bg-white px-2 py-1.5 ${className}`}>
      <svg
        width={svgWidth}
        height={height}
        viewBox={`0 0 ${svgWidth} ${height}`}
        role="img"
        aria-label={`Code 128 barcode ${encoded.text}`}
        shapeRendering="crispEdges"
        style={{ maxWidth: '100%', height: `${height}px`, display: 'block', background: '#ffffff' }}
      >
        <rect x={0} y={0} width={svgWidth} height={height} fill="#ffffff" />
        {encoded.bars.map((bar, idx) => (
          <rect
            key={idx}
            x={bar.x * barWidth}
            y={0}
            width={bar.width * barWidth}
            height={height}
            fill="#000000"
          />
        ))}
      </svg>
      {showText && (
        <span className="mt-1 font-mono text-[10px] font-bold tracking-[0.14em] text-slate-900 tabular-nums">
          {encoded.text}
        </span>
      )}
    </div>
  );
};

export default Code128Barcode;
