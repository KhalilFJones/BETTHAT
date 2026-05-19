import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

let initialized = false;

export function initSentry() {
  if (initialized) return;
  initialized = true;

  if (!dsn) {
    // No DSN configured (dev / local) — wire a noop so callers don't have to guard.
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.EXPO_PUBLIC_ENV ?? (__DEV__ ? 'development' : 'production'),
    release: Constants.expoConfig?.version ?? 'unknown',
    enableAutoSessionTracking: true,
    tracesSampleRate: 0.1,
    enableNative: true,
  });
}

export function captureError(err: unknown, context?: Record<string, unknown>) {
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.error('[captureError]', err, context);
  }
  if (!initialized || !dsn) return;
  Sentry.captureException(err, { extra: context });
}

export function setUserContext(userId: string | null) {
  if (!initialized || !dsn) return;
  Sentry.setUser(userId ? { id: userId } : null);
}
