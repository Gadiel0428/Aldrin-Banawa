/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { Globe } from 'lucide-react';
import { en, type TranslationDict, type TranslationKey } from './en';
import { fil } from './fil';

export type LanguageCode = 'en' | 'fil';

const DICTIONARIES: Record<LanguageCode, TranslationDict> = {
  en,
  fil,
};

const LANG_STORAGE_PREFIX = 'juwei_wms_lang_';

function resolveInitialLanguage(): LanguageCode {
  if (typeof window === 'undefined' || !window.localStorage) return 'en';
  try {
    const guest = window.localStorage.getItem(`${LANG_STORAGE_PREFIX}GUEST`);
    if (isValidLanguageCode(guest)) return guest;
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(LANG_STORAGE_PREFIX)) {
        const val = window.localStorage.getItem(k);
        if (isValidLanguageCode(val)) return val;
      }
    }
  } catch {
    // Ignore storage errors
  }
  return 'en';
}

let currentGlobalLanguage: LanguageCode = typeof window !== 'undefined' ? resolveInitialLanguage() : 'en';

export function normalizeUserLangKey(userKey?: string): string {
  const clean = String(userKey ?? '').trim().toUpperCase();
  return clean || 'GUEST';
}

export function getUserLangStorageKey(userKey?: string): string {
  return `${LANG_STORAGE_PREFIX}${normalizeUserLangKey(userKey)}`;
}

export function isValidLanguageCode(val: unknown): val is LanguageCode {
  return val === 'en' || val === 'fil';
}

export function readStoredUserLanguage(userKey?: string): LanguageCode {
  if (typeof window === 'undefined' || !window.localStorage) return 'en';
  try {
    const raw = window.localStorage.getItem(getUserLangStorageKey(userKey));
    return isValidLanguageCode(raw) ? raw : 'en';
  } catch {
    return 'en';
  }
}

export function writeStoredUserLanguage(lang: LanguageCode, userKey?: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(getUserLangStorageKey(userKey), lang);
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}

export function getCurrentLanguage(): LanguageCode {
  return currentGlobalLanguage;
}

export function setCurrentGlobalLanguage(lang: LanguageCode): void {
  currentGlobalLanguage = lang;
}

function getNestedValue(dict: TranslationDict, path: string): string | undefined {
  const parts = path.split('.');
  let curr: any = dict;
  for (const part of parts) {
    if (curr && typeof curr === 'object' && part in curr) {
      curr = curr[part];
    } else {
      return undefined;
    }
  }
  return typeof curr === 'string' ? curr : undefined;
}

export function interpolateTemplate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_match, name) => {
    return vars[name] !== undefined && vars[name] !== null ? String(vars[name]) : `{${name}}`;
  });
}

export function translate(
  key: TranslationKey,
  vars?: Record<string, string | number>,
  langOverride?: LanguageCode
): string {
  const activeLang = langOverride ?? currentGlobalLanguage;
  const targetDict = DICTIONARIES[activeLang] ?? en;
  const template = getNestedValue(targetDict, key) ?? getNestedValue(en, key) ?? key;
  return interpolateTemplate(template, vars);
}

/**
 * Translates English server/client validation messages emitted by shared/validation.ts
 * into the user's selected UI language without mutating server/CI error contracts.
 */
export function localizeValidationMessage(
  rawMessage?: string,
  langOverride?: LanguageCode
): string {
  const msg = String(rawMessage ?? '').trim();
  if (!msg) return '';
  const activeLang = langOverride ?? currentGlobalLanguage;
  if (activeLang === 'en') return msg;

  // Exact matches
  const exactMap: Record<string, TranslationKey> = {
    'Arrival classification / category is required.': 'validation.classificationRequired',
    'Model / Part Code is required.': 'validation.modelPartCodeRequired',
    'Storage location is required.': 'validation.locationRequired',
    'Unit of Measure (UOM) is required.': 'validation.uomRequired',
    'Quantity must be greater than 0 (negative or zero values are not allowed).': 'validation.quantityPositive',
    'Dispatch quantity must be greater than 0 (negative or zero values are not allowed).': 'validation.dispatchQtyPositive',
    'Quantity requested must be greater than 0 (negative or zero values are not allowed).': 'validation.qtyRequestedPositive',
    'Quantity issued must be greater than 0 (negative or zero values are not allowed).': 'validation.qtyIssuedPositive',
    'Stock quantity cannot be negative.': 'validation.stockQtyNonNegative',
    'Expiry date must be a valid YYYY-MM-DD date.': 'validation.expiryInvalidFormat',
    'RR number must match format RR-YYYY-NNNN (e.g. RR-2026-0001).': 'validation.rrInvalidFormat',
    'PO number must match format PO-YYYY-NNNN (e.g. PO-2026-0001).': 'validation.poInvalidFormat',
    'PO number is required and must match format PO-YYYY-NNNN (e.g. PO-2026-0001).': 'validation.poRequiredFormat',
    'DR number must match format DR-NNNNN (e.g. DR-00001).': 'validation.drInvalidFormat',
    'DR number is required (format DR-NNNNN, e.g. DR-00001).': 'validation.drRequiredFormat',
    'SI number must match format SI-NNNNN (e.g. SI-00001).': 'validation.siInvalidFormat',
    'SI number is required (format SI-NNNNN, e.g. SI-00001).': 'validation.siRequiredFormat',
    'Requisition slip number is required.': 'validation.requisitionRequired',
    'Part code is required.': 'validation.partCodeRequired',
    'Lot number is required.': 'validation.lotNumberRequired',
    'Receiver name / signature is required.': 'validation.receiverRequired',
    'Override reason is required when selecting a newer lot.': 'validation.overrideReasonRequired',
    'Super Admin approval is required when selecting a newer lot.': 'validation.superAdminApprovalRequired',
    'Picking List (DPL) number is required.': 'validation.pickingListRequired',
    'Model / Description is required.': 'validation.modelNameRequired',
    'Part Code is required.': 'validation.partCodeRequired',
    'Waybill number is required for gate pass release.': 'validation.waybillRequired',
  };

  const exactKey = exactMap[msg];
  if (exactKey) return translate(exactKey, undefined, activeLang);

  // Dynamic patterns
  const expiryMatch = msg.match(/^Expiry date \(([^)]+)\) cannot be earlier than the receipt date \(([^)]+)\)\.$/);
  if (expiryMatch) {
    return translate(
      'validation.expiryBeforeReceipt',
      { expiry: expiryMatch[1], receipt: expiryMatch[2] },
      activeLang
    );
  }

  const dupMatch = msg.match(/^Duplicate (RR|PO|DR|SI) number "([^"]+)" already exists\.$/);
  if (dupMatch) {
    return translate(
      'validation.duplicateDoc',
      { docType: dupMatch[1], value: dupMatch[2] },
      activeLang
    );
  }

  const exceedMatch = msg.match(/^Quantity issued cannot exceed available lot stock \(([^)]+)\)\.$/);
  if (exceedMatch) {
    return translate('validation.qtyIssuedExceedsLot', { available: exceedMatch[1] }, activeLang);
  }

  return msg;
}

export interface I18nContextValue {
  language: LanguageCode;
  userKey: string;
  setLanguage: (lang: LanguageCode) => void;
  toggleLanguage: () => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
  localizeValidation: (rawMessage?: string) => string;
  dateLocale: string;
}

const I18nContext = createContext<I18nContextValue>({
  language: 'en',
  userKey: 'GUEST',
  setLanguage: () => {},
  toggleLanguage: () => {},
  t: (key, vars) => translate(key, vars, 'en'),
  localizeValidation: (msg) => String(msg ?? ''),
  dateLocale: 'en-US',
});

export interface LanguageProviderProps {
  userKey?: string;
  children: React.ReactNode;
}

export const LanguageProvider: React.FC<LanguageProviderProps> = ({ userKey, children }) => {
  const normalizedUserKey = normalizeUserLangKey(userKey);
  const [language, setLanguageState] = useState<LanguageCode>(() => {
    const initial = readStoredUserLanguage(normalizedUserKey);
    currentGlobalLanguage = initial;
    return initial;
  });

  // Restore saved preference whenever authenticated operator / guest context changes
  useEffect(() => {
    const saved = readStoredUserLanguage(normalizedUserKey);
    currentGlobalLanguage = saved;
    setLanguageState(saved);
  }, [normalizedUserKey]);

  // Keep <html lang="..."> synced for accessibility and screen readers
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = language === 'fil' ? 'zh-CN' : 'en';
    }
  }, [language]);

  const setLanguage = useCallback(
    (nextLang: LanguageCode) => {
      currentGlobalLanguage = nextLang;
      writeStoredUserLanguage(nextLang, normalizedUserKey);
      setLanguageState(nextLang);
    },
    [normalizedUserKey]
  );

  const toggleLanguage = useCallback(() => {
    setLanguageState((prev) => {
      const next: LanguageCode = prev === 'en' ? 'fil' : 'en';
      currentGlobalLanguage = next;
      writeStoredUserLanguage(next, normalizedUserKey);
      return next;
    });
  }, [normalizedUserKey]);

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>) => translate(key, vars, language),
    [language]
  );

  const localizeValidation = useCallback(
    (rawMessage?: string) => localizeValidationMessage(rawMessage, language),
    [language]
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      userKey: normalizedUserKey,
      setLanguage,
      toggleLanguage,
      t,
      localizeValidation,
      dateLocale: language === 'fil' ? 'zh-CN' : 'en-US',
    }),
    [language, normalizedUserKey, setLanguage, toggleLanguage, t, localizeValidation]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

export interface LanguageSwitchProps {
  compact?: boolean;
  dark?: boolean;
  className?: string;
}

export const LanguageSwitch: React.FC<LanguageSwitchProps> = ({
  compact = false,
  dark = false,
  className = '',
}) => {
  const { language, setLanguage, t } = useI18n();

  const containerClass = dark
    ? 'inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-slate-800/90 border border-slate-700 text-[11px] font-semibold'
    : 'inline-flex items-center gap-0.5 p-0.5 rounded-xl bg-slate-100/90 border border-slate-200/90 h-8 text-xs font-semibold shadow-2xs';

  const getBtnClass = (isActive: boolean) => {
    if (dark) {
      return isActive
        ? 'px-2 py-1 rounded-md bg-indigo-600 text-white shadow-xs transition-all cursor-pointer'
        : 'px-2 py-1 rounded-md text-slate-300 hover:text-white hover:bg-slate-700/70 transition-all cursor-pointer';
    }
    return isActive
      ? 'px-2 py-1 rounded-lg bg-indigo-600 text-white shadow-xs transition-all cursor-pointer'
      : 'px-2 py-1 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-white/80 transition-all cursor-pointer';
  };

  return (
    <div
      className={`${containerClass} ${className}`}
      role="group"
      aria-label={t('language.label')}
      title={t('language.switchTitle')}
      data-testid="language-switch"
    >
      <Globe className={`h-3.5 w-3.5 ml-1.5 mr-0.5 shrink-0 ${dark ? 'text-indigo-400' : 'text-indigo-600'}`} />
      <button
        type="button"
        onClick={() => setLanguage('en')}
        aria-pressed={language === 'en'}
        data-testid="lang-btn-en"
        className={getBtnClass(language === 'en')}
      >
        {compact ? t('language.shortEn') : t('language.english')}
      </button>
      <button
        type="button"
        onClick={() => setLanguage('fil')}
        aria-pressed={language === 'fil'}
        data-testid="lang-btn-zh"
        className={getBtnClass(language === 'fil')}
      >
        {compact ? t('language.shortZh') : t('language.chinese')}
      </button>
    </div>
  );
};

export type { TranslationDict, TranslationKey };
