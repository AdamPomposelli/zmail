import { describe, expect, it } from 'vitest';
import { appleGuidance } from '../src/ai/apple';

describe('Apple Intelligence diagnosis', () => {
  it('names the language mismatch when Siri and the Mac differ', () => {
    const g = appleGuidance('modelNotReady', { systemLanguage: 'en-US', systemLanguageName: 'anglais (États-Unis)', siriLanguage: 'fr-FR', siriLanguageName: 'français (France)', languagesMatch: false, systemLanguageSupported: true })!;
    expect(g).toMatchObject({ cause: 'language_mismatch', detected: true });
    expect(g.message).toContain('anglais (États-Unis)');
    expect(g.message).toContain('français (France)');
    expect(g.settingsUrl).toContain('Siri-Settings');
  });

  it('says a download is in progress once languages are consistent', () => {
    expect(appleGuidance('modelNotReady', { systemLanguage: 'fr-FR', siriLanguage: 'fr-FR', languagesMatch: true, systemLanguageSupported: true })).toMatchObject({ cause: 'downloading', detected: true });
  });

  it('still mentions the language mismatch as the likely cause when it cannot check', () => {
    const g = appleGuidance('modelNotReady', { systemLanguage: 'en-US', siriLanguage: null, languagesMatch: null })!;
    expect(g).toMatchObject({ cause: 'unknown', detected: false });
    expect(g.message).toMatch(/pas pu lire la langue de Siri/);
    expect(g.message).toMatch(/même langue/);
  });

  it('explains the browser case and stays silent when available', () => {
    expect(appleGuidance('app_not_running', undefined)?.cause).toBe('browser');
    expect(appleGuidance(null, undefined)).toBeNull();
  });
});
