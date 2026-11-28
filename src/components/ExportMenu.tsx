/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Download } from 'lucide-react';
import { useI18n } from '../i18n';

export interface ExportMenuItem {
  id?: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
  title?: string;
  description?: string;
}

interface ExportMenuProps {
  id?: string;
  label?: string;
  title?: string;
  items: ExportMenuItem[];
  variant?: 'emerald' | 'indigo' | 'dark' | 'slate' | 'light';
  menuAlign?: 'left' | 'right';
  dropUp?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  buttonClassName?: string;
}

const VARIANT_CLASSES: Record<NonNullable<ExportMenuProps['variant']>, string> = {
  emerald:
    'bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-400/30 shadow-xs',
  indigo:
    'bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-400/30 shadow-xs',
  dark:
    'bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 shadow-xs',
  slate:
    'bg-slate-900 hover:bg-slate-800 text-white border border-slate-800 shadow-xs',
  light:
    'bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 shadow-2xs',
};

export const ExportMenu: React.FC<ExportMenuProps> = ({
  id,
  label,
  title,
  items,
  variant = 'indigo',
  menuAlign = 'right',
  dropUp = false,
  disabled = false,
  icon,
  buttonClassName,
}) => {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const effectiveLabel = label || t('common.export');
  const allItemsDisabled = items.length === 0 || items.every((item) => item.disabled);
  const isButtonDisabled = disabled || allItemsDisabled;

  return (
    <div ref={containerRef} className="relative inline-block shrink-0 print:hidden">
      <button
        type="button"
        id={id}
        disabled={isButtonDisabled}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        title={title || effectiveLabel}
        className={
          buttonClassName ||
          `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]}`
        }
      >
        {icon || <Download className="h-3.5 w-3.5 shrink-0" />}
        <span>{effectiveLabel}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 transition-transform duration-150 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div
          role="menu"
          className={`absolute z-[120] w-60 rounded-xl bg-white border border-slate-200 shadow-xl py-1.5 text-slate-800 ${
            dropUp ? 'bottom-full mb-1.5' : 'mt-1.5'
          } ${menuAlign === 'left' ? 'left-0' : 'right-0'}`}
        >
          {items.map((item, idx) => (
            <button
              key={item.id || `${item.label}-${idx}`}
              type="button"
              id={item.id}
              role="menuitem"
              disabled={item.disabled}
              title={item.title}
              onClick={() => {
                if (item.disabled) return;
                setIsOpen(false);
                item.onClick();
              }}
              className="w-full text-left px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 disabled:opacity-45 disabled:cursor-not-allowed flex items-start gap-2.5 transition-colors cursor-pointer"
            >
              {item.icon && <span className="mt-0.5 shrink-0 text-slate-500">{item.icon}</span>}
              <span className="min-w-0 flex-1">
                <span className="block leading-snug">{item.label}</span>
                {item.description && (
                  <span className="block text-[10px] font-normal text-slate-500 mt-0.5 leading-tight">
                    {item.description}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
