import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { PRODUCT_BRAND } from '../product-brand';
import { isSupabaseConfigured, signIn } from '../services/SupabaseService';

/**
 * Shown by the native root whenever nobody is signed in. Work is only ever
 * created inside a signed-in owner workspace, so nothing a person records can
 * be discarded later by an account transition. Saved work for every account
 * stays on the device and opens again after sign-in.
 *
 * Success is not handled here: the auth listener in the native root activates
 * the owner workspace when the SIGNED_IN event arrives.
 */
export function NativeSignInGate() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const configured = isSupabaseConfigured();

  async function submit() {
    if (inFlight.current) return;
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setMessage('Enter your email and password.');
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    setMessage(null);
    try {
      const result = await signIn({ email: trimmedEmail, password });
      if (!result.ok) setMessage(signInFailureMessage(result.error || result.message || ''));
    } catch {
      setMessage('Vitruvius could not reach the sign-in service. Check your connection and try again.');
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.screen}
    >
      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.title}>
          Sign in to {PRODUCT_BRAND.name}
        </Text>
        <Text style={styles.body}>
          Sign in before recording project work. Anything already saved on this
          device stays here and opens after you sign in.
        </Text>

        {configured ? null : (
          <Text accessibilityRole="alert" style={styles.error}>
            This build is not connected to a Vitruvius account service, so sign-in is unavailable.
          </Text>
        )}

        <Text style={styles.label}>Email</Text>
        <TextInput
          accessibilityLabel="Email"
          autoCapitalize="none"
          autoComplete="email"
          autoCorrect={false}
          editable={!submitting}
          inputMode="email"
          keyboardType="email-address"
          onChangeText={setEmail}
          returnKeyType="next"
          style={styles.input}
          textContentType="username"
          value={email}
        />

        <Text style={styles.label}>Password</Text>
        <TextInput
          accessibilityLabel="Password"
          autoCapitalize="none"
          autoComplete="current-password"
          autoCorrect={false}
          editable={!submitting}
          onChangeText={setPassword}
          onSubmitEditing={() => { void submit(); }}
          returnKeyType="go"
          secureTextEntry
          style={styles.input}
          textContentType="password"
          value={password}
        />

        {message ? (
          <Text accessibilityRole="alert" style={styles.error}>{message}</Text>
        ) : null}

        <Pressable
          accessibilityLabel="Sign in"
          accessibilityRole="button"
          accessibilityState={{ disabled: submitting || !configured, busy: submitting }}
          disabled={submitting || !configured}
          onPress={() => { void submit(); }}
          style={[styles.button, (submitting || !configured) && styles.buttonDisabled]}
        >
          {submitting
            ? <ActivityIndicator color="#FFFFFF" />
            : <Text style={styles.buttonText}>Sign in</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

export function signInFailureMessage(raw: string): string {
  if (/invalid login|invalid credentials|email not confirmed/i.test(raw)) {
    return 'That email or password was not accepted.';
  }
  if (/network|fetch|timeout|timed out|offline/i.test(raw)) {
    return 'Vitruvius could not reach the sign-in service. Check your connection and try again.';
  }
  if (/rate|too many/i.test(raw)) {
    return 'Too many sign-in attempts. Wait a minute and try again.';
  }
  return 'Sign-in did not complete. Try again.';
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#F5F7FA',
  },
  card: {
    width: '100%',
    maxWidth: 440,
    padding: 24,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
  },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '700', color: '#101828' },
  body: { marginTop: 10, fontSize: 16, lineHeight: 23, color: '#475467' },
  label: { marginTop: 18, marginBottom: 6, fontSize: 15, fontWeight: '600', color: '#344054' },
  input: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#98A2B3',
    fontSize: 17,
    color: '#101828',
    backgroundColor: '#FFFFFF',
  },
  error: { marginTop: 14, fontSize: 15, lineHeight: 21, color: '#B42318' },
  button: {
    marginTop: 22,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#0B5CAD',
  },
  buttonDisabled: { opacity: 0.55 },
  buttonText: { fontSize: 17, fontWeight: '700', color: '#FFFFFF' },
});
