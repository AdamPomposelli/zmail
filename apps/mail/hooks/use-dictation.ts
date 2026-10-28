import { useCallback, useEffect, useRef, useState } from 'react';
import { isNativeApp, postNative } from '@/lib/native';
import { intlLocale, t } from '@/lib/i18n';

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

const browserRecognizer = (): (new () => SpeechRecognitionLike) | null => {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => SpeechRecognitionLike) | null;
};

/**
 * Voice input. In the macOS app: the system's speech recognition, on the Mac (free, private),
 * through the native bridge. In a browser: the Web Speech API when it exists.
 * `text` is the live transcript; `level` (0…1) drives the waveform.
 */
export function useDictation() {
  const native = isNativeApp();
  const supported = native || browserRecognizer() !== null;
  const [listening, setListening] = useState(false);
  const [text, setText] = useState('');
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recognizer = useRef<SpeechRecognitionLike | null>(null);
  const base = useRef('');

  useEffect(() => {
    if (!native) return;
    const onEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ text: string; final: boolean; level: number; error?: string }>).detail;
      if (detail.error) setError(detail.error);
      if (detail.text) setText(base.current + detail.text);
      if (detail.level !== undefined) setLevel(detail.level);
      if (detail.final) (setListening(false), setLevel(0));
    };
    window.addEventListener('zmail:dictation', onEvent);
    return () => window.removeEventListener('zmail:dictation', onEvent);
  }, [native]);

  const start = useCallback(
    (keep = '') => {
      setError(null);
      base.current = keep ? `${keep.trim()} ` : '';
      setText(keep);
      const language = navigator.language || intlLocale;
      if (native) {
        postNative({ type: 'dictation', action: 'start', language });
        setListening(true);
        return;
      }
      const Recognition = browserRecognizer();
      if (!Recognition) return setError(t('La dictée n’est pas disponible dans ce navigateur.'));
      const r = new Recognition();
      r.lang = language;
      r.continuous = true;
      r.interimResults = true;
      r.onresult = (event) => {
        let transcript = '';
        for (let i = 0; i < event.results.length; i++) transcript += event.results[i]![0].transcript;
        setText(base.current + transcript);
        setLevel(0.4 + Math.random() * 0.4);
      };
      r.onerror = (event) => event.error !== 'no-speech' && event.error !== 'aborted' && setError(t('Micro indisponible ou refusé.'));
      r.onend = () => (setListening(false), setLevel(0));
      recognizer.current = r;
      r.start();
      setListening(true);
    },
    [native],
  );

  const stop = useCallback(() => {
    if (native) postNative({ type: 'dictation', action: 'stop' });
    recognizer.current?.stop();
    setListening(false);
    setLevel(0);
  }, [native]);

  useEffect(() => () => recognizer.current?.stop(), []);

  return { supported, listening, text, setText, level, error, start, stop };
}
