import { useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, ActivityIndicator, Alert, Keyboard, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputInstance } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import * as SplashScreen from 'expo-splash-screen'
import { SvgXml } from 'react-native-svg'
import { isEmailAddress, NOT_AN_EMAIL } from '@shared/text'
import { sync } from '../core/app'
import { useStore } from '../core/store'
import { lockup } from '../ui/lockup'
import { metrics, useColors } from '../ui/theme'

/**
 * Cue on iPhone needs an account: the phone holds a copy of the notes, and sync keeps it
 * the same as every other device. Sign-in is the Mac's: an email, then a six-digit code.
 * iOS offers the code from Mail or Messages above the keyboard. The words are the Mac's.
 */
export default function SignIn() {
  const c = useColors()
  const insets = useSafeAreaInsets()
  // Why this phone was signed out, if the server ended the session.
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

  useEffect(() => {
    if (error) AccessibilityInfo.announceForAccessibility(error)
  }, [error])

  const sendCode = async (): Promise<void> => {
    if (busy) return
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

  /** Before a code goes out, say so if signing in could remove changes the last account never got. */
  const submitEmail = (): void => {
    if (busy || !email.trim()) return
    if (!isEmailAddress(email)) {
      setError(NOT_AN_EMAIL)
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      return
    }
    const unsent = sync.unsentFromPreviousAccount()
    if (!unsent) {
      void sendCode()
      return
    }
    const waiting = unsent === 1 ? '1 change on this iPhone hasn’t' : `${unsent} changes on this iPhone haven’t`
    // With the keyboard up after a server sign-out, iOS can present the alert out of sight.
    Keyboard.dismiss()
    Alert.alert(
      'Some changes haven’t synced',
      `${waiting} reached your account. Signing in to a different account, or to one that was deleted, removes ${unsent === 1 ? 'it' : 'them'}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Continue', onPress: () => void sendCode() }
      ]
    )
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
    <KeyboardAvoidingView behavior="padding" style={[styles.keyboard, { backgroundColor: c.bg, paddingTop: insets.top }]}>
      {/* At the largest text sizes the form can sit under the keyboard: it scrolls, and the first tap still sends. */}
      <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.brand}>
          <SvgXml xml={lockup(c.text)} width={104} height={52} accessibilityLabel="Cue" />
          <Text style={[styles.tagline, { color: c.text2 }]}>Every day is a page.</Text>
        </View>

        <View style={styles.form}>
          {step === 'email' ? (
            <>
              {notice && <Text style={[styles.notice, { color: c.text }]}>{notice}</Text>}
              <View>
                <Text style={[styles.label, { color: c.text }]}>Sign in to sync your notes</Text>
                <Text style={[styles.help, { color: c.text2 }]}>Enter your email and we’ll send a six-digit code.</Text>
              </View>
              <TextInput
                value={email}
                onChangeText={setEmail}
                onSubmitEditing={submitEmail}
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
              <Button label="Send Code" busy={busy} disabled={!email.trim()} onPress={submitEmail} />
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
                <Pressable onPress={sendCode} hitSlop={8} disabled={busy} accessibilityRole="button">
                  <Text style={[styles.link, { color: c.text2 }]}>Send a New Code</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setStep('email')
                    setError(null)
                  }}
                  hitSlop={8}
                  accessibilityRole="button"
                >
                  <Text style={[styles.link, { color: c.text2 }]}>Use a Different Email</Text>
                </Pressable>
              </View>
            </>
          )}
          {error && (
            <Text style={[styles.error, { color: c.text }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
              {error}
            </Text>
          )}
        </View>

        <Text style={[styles.footnote, { color: c.text2 }]}>
          Your notes sync across your devices. New here? The code creates your account.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

function Button({ label, busy, disabled, onPress }: { label: string; busy: boolean; disabled?: boolean; onPress: () => void }) {
  const c = useColors()
  return (
    <Pressable
      onPress={onPress}
      disabled={busy || disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: busy || !!disabled }}
      style={({ pressed }) => [styles.button, { backgroundColor: c.accent, opacity: disabled ? 0.45 : pressed || busy ? 0.75 : 1 }]}
    >
      {busy ? <ActivityIndicator color={c.onAccent} /> : <Text style={[styles.buttonText, { color: c.onAccent }]}>{label}</Text>}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  keyboard: {
    flex: 1
  },
  screen: {
    flexGrow: 1,
    paddingTop: 56,
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
  notice: {
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 20,
    marginBottom: 8
  },
  label: {
    fontSize: 17,
    fontWeight: '600'
  },
  help: {
    fontSize: 15,
    lineHeight: 20,
    marginTop: 4
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
    minHeight: 50,
    paddingVertical: 12,
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
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    columnGap: 16,
    rowGap: 8,
    marginTop: 4
  },
  link: {
    fontSize: 15
  },
  error: {
    fontSize: 15,
    fontWeight: '500',
    marginTop: 4
  },
  footnote: {
    marginTop: 'auto',
    fontSize: 13,
    lineHeight: 18
  }
})
