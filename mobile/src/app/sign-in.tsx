import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Pressable, StyleSheet, Text, TextInput, View, type TextInputInstance } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import * as SplashScreen from 'expo-splash-screen'
import { SvgXml } from 'react-native-svg'
import { sync } from '../core/app'
import { useStore } from '../core/store'
import { lockup } from '../ui/lockup'
import { metrics, useColors } from '../ui/theme'

/**
 * Cue on iPhone needs an account: the phone holds a copy of the notes, and sync keeps it
 * the same as every other device. Sign-in is the Mac's: an email, then a six-digit code.
 * iOS offers the code from Mail or Messages above the keyboard.
 */
export default function SignIn() {
  const c = useColors()
  const insets = useSafeAreaInsets()
  const notice = useStore(sync.state, (s) => s.message)
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const codeInput = useRef<TextInputInstance>(null)

  useEffect(() => {
    void SplashScreen.hideAsync()
  }, [])

  const sendCode = async (): Promise<void> => {
    if (busy || !/\S+@\S+\.\S+/.test(email.trim())) {
      setError('Enter your email address.')
      return
    }
    setBusy(true)
    setError(null)
    const result = await sync.sendCode(email)
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      return
    }
    setStep('code')
    setCode('')
    requestAnimationFrame(() => codeInput.current?.focus())
  }

  const verify = async (value: string): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    const result = await sync.verifyCode(email, value)
    setBusy(false)
    if (result.ok) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      return
    }
    setError(result.error)
    setCode('')
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
  }

  const onCode = (value: string): void => {
    const digits = value.replace(/\D/g, '').slice(0, 6)
    setCode(digits)
    if (digits.length === 6) void verify(digits)
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.screen, { backgroundColor: c.bg, paddingTop: insets.top + 56, paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.brand}>
        <SvgXml xml={lockup(c.text)} width={104} height={52} accessibilityLabel="Cue" />
        <Text style={[styles.tagline, { color: c.text2 }]}>Every day is a page.</Text>
      </View>

      <View style={styles.form}>
        {step === 'email' ? (
          <>
            <Text style={[styles.label, { color: c.text }]}>Sign in to sync your notes</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              onSubmitEditing={sendCode}
              placeholder="you@example.com"
              placeholderTextColor={c.text3}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              returnKeyType="send"
              selectionColor={c.accent}
              style={[styles.field, { color: c.text, backgroundColor: c.bgSubtle }]}
              accessibilityLabel="Email"
              testID="email"
            />
            <Button label="Send code" busy={busy} onPress={sendCode} />
          </>
        ) : (
          <>
            <Text style={[styles.label, { color: c.text }]}>Enter the code we sent to</Text>
            <Text style={[styles.email, { color: c.text2 }]}>{email.trim()}</Text>
            <TextInput
              ref={codeInput}
              value={code}
              onChangeText={onCode}
              placeholder="000000"
              placeholderTextColor={c.text3}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              maxLength={6}
              selectionColor={c.accent}
              style={[styles.field, styles.code, { color: c.text, backgroundColor: c.bgSubtle }]}
              accessibilityLabel="Six-digit code"
              testID="code"
            />
            {busy && <ActivityIndicator color={c.text2} style={styles.spinner} />}
            <View style={styles.links}>
              <Pressable onPress={sendCode} hitSlop={8} disabled={busy}>
                <Text style={[styles.link, { color: c.text2 }]}>Send a new code</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setStep('email')
                  setError(null)
                }}
                hitSlop={8}
              >
                <Text style={[styles.link, { color: c.text2 }]}>Use a different email</Text>
              </Pressable>
            </View>
          </>
        )}
        {(error ?? notice) && <Text style={[styles.error, { color: c.text }]}>{error ?? notice}</Text>}
      </View>

      <Text style={[styles.footnote, { color: c.text3 }]}>
        Your notes sync across your devices. New here? The code creates your account.
      </Text>
    </KeyboardAvoidingView>
  )
}

function Button({ label, busy, onPress }: { label: string; busy: boolean; onPress: () => void }) {
  const c = useColors()
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      style={({ pressed }) => [styles.button, { backgroundColor: c.accent, opacity: pressed || busy ? 0.75 : 1 }]}
    >
      {busy ? <ActivityIndicator color={c.onAccent} /> : <Text style={[styles.buttonText, { color: c.onAccent }]}>{label}</Text>}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: metrics.gutter + 8
  },
  brand: {
    alignItems: 'flex-start',
    gap: 14
  },
  tagline: {
    fontSize: 17
  },
  form: {
    marginTop: 48,
    gap: 12
  },
  label: {
    fontSize: 17,
    fontWeight: '600'
  },
  email: {
    fontSize: 15,
    marginTop: -6
  },
  field: {
    height: 50,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 17
  },
  code: {
    fontSize: 26,
    letterSpacing: 8,
    fontVariant: ['tabular-nums']
  },
  button: {
    height: 50,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  buttonText: {
    fontSize: 17,
    fontWeight: '600'
  },
  spinner: {
    alignSelf: 'flex-start'
  },
  links: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4
  },
  link: {
    fontSize: 15
  },
  error: {
    fontSize: 15,
    marginTop: 4
  },
  footnote: {
    marginTop: 'auto',
    fontSize: 13,
    lineHeight: 18
  }
})
