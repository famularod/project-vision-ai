import { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { daveWebSupabaseGateway } from '../services/DAVEWebSupabaseClient';
import { displayFontFamily } from '../theme/typography';

type AuthorizationState = 'authorizing' | 'complete' | 'unavailable' | 'failed';

function authorizationFailureMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message.trim() : '';
  return detail
    ? `Authorization did not complete: ${detail}`
    : 'Authorization did not complete. Confirm this browser tab is signed in to Vitruvius, then reopen the validation link.';
}

export default function ECOSAcceptanceAuthorizationPage() {
  const params = useLocalSearchParams<{ port?: string | string[]; nonce?: string | string[] }>();
  const [state, setState] = useState<AuthorizationState>('authorizing');
  const [message, setMessage] = useState('Authorizing the protected ECOS shadow validation.');
  const request = useMemo(() => {
    const portValue = Array.isArray(params.port) ? params.port[0] : params.port;
    const nonceValue = Array.isArray(params.nonce) ? params.nonce[0] : params.nonce;
    return {
      port: Number(portValue),
      nonce: String(nonceValue || '').trim().toLowerCase(),
    };
  }, [params.nonce, params.port]);

  useEffect(() => {
    let cancelled = false;
    if (Platform.OS !== 'web' || typeof __DEV__ === 'undefined' || !__DEV__) {
      setState('unavailable');
      setMessage('This protected validation page is available only on the local Vitruvius development site.');
      return () => { cancelled = true; };
    }
    void daveWebSupabaseGateway.authorizeLocalAcceptanceBridge(request)
      .then(() => {
        if (cancelled) return;
        setState('complete');
        setMessage('Authorization complete. You may close this tab while the acceptance test continues.');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState('failed');
        setMessage(authorizationFailureMessage(error));
      });
    return () => { cancelled = true; };
  }, [request]);

  return (
    <View style={styles.page}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>ECOS ASSURANCE</Text>
        <Text style={styles.title}>Protected validation authorization</Text>
        <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text>
        <Text style={[styles.status, state === 'complete' && styles.statusComplete]}>
          {state === 'authorizing' ? 'Authorizing…' : state === 'complete' ? 'Authorized' : 'Not authorized'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    alignItems: 'center',
    backgroundColor: '#F3F1EC',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#ffffff',
    borderColor: '#DDD9D2',
    borderRadius: 12,
    borderWidth: 1,
    maxWidth: 620,
    padding: 32,
    width: '100%',
  },
  eyebrow: {
    color: '#1F3A2E',
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 1.5,
  },
  title: {
    color: '#1A1A18',
    fontSize: 34,
    fontFamily: displayFontFamily,
    fontWeight: '400',
    marginTop: 12,
  },
  message: {
    color: '#3A3935',
    fontSize: 17,
    lineHeight: 26,
    marginTop: 18,
  },
  status: {
    color: '#b42318',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 22,
  },
  statusComplete: {
    color: '#19713d',
  },
});
