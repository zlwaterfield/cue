import { useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, ActivityIndicator, Keyboard, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, useColorScheme, View, type TextInputInstance } from 'react-native'
import * as AppleAuthentication from 'expo-apple-authentication'
import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import { SvgXml } from 'react-native-svg'
import { isEmailAddress, NOT_AN_EMAIL } from '@shared/text'
import { appleSignIn, sync } from '../core/app'
import { useStore } from '../core/store'
import { lockup } from '../ui/lockup'
import { metrics, useColors } from '../ui/theme'

/**
 * Turning sync on, from Settings. Sign-in is the Mac's: Sign in with Apple, or an email
 * and then a six-digit code, which iOS offers from Mail or Messages above the keyboard.
 * Signed in, the notes already on this phone go to the account, and the day comes back.
 * The words are the Mac's.
 */
export default function SignIn() {
  const c = useColors()
  const scheme = useColorScheme()
  // Why sync stopped, if the server ended the session; signing in again starts with its email.
  const notice = useStore(sync.state, (s) => (s.needsSignIn ? s.message : null))
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState(() => sync.state.get().previousEmail ?? '')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [appleBusy, setAppleBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const codeInput = useRef<TextInputInstance>(null)

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

  const submitEmail = (): void => {
    if (busy || appleBusy || !email.trim()) return
    if (!isEmailAddress(email)) {
      setError(NOT_AN_EMAIL)
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      return
    }
    void sendCode()
  }

  const signInWithApple = async (): Promise<void> => {
    if (busy || appleBusy) return
    Keyboard.dismiss()
    setAppleBusy(true)
    setError(null)
    const result = await sync.signInWithApple()
    setAppleBusy(false)
    if (result.ok) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      router.dismissAll()
      return
    }
    // Cancelled in Apple's sheet: nothing to say.
    if (!result.error) return
    setError(result.error)
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
  }

  const verify = async (value: string): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    const result = await sync.verifyCode(email, value)
    setBusy(false)
    if (result.ok) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      router.dismissAll()
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
    <KeyboardAvoidingView behavior="padding" style={[styles.keyboard, { backgroundColor: c.bg }]}>
      {/* At the largest text sizes the form can sit under the keyboard: it scrolls, and the first tap still sends. */}
      <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} hitSlop={8} accessibilityRole="button" style={styles.cancel} testID="sign-in-cancel">
          <Text style={[styles.cancelText, { color: c.text }]}>Cancel</Text>
        </Pressable>
        <View style={styles.brand}>
          <SvgXml xml={lockup(c.text)} width={104} height={52} accessibilityLabel="Cue" />
          <Text style={[styles.tagline, { color: c.text2 }]}>Every day is a page.</Text>
        </View>

        <View style={styles.form}>
          {step === 'email' ? (
            <>
              {notice && <Text style={[styles.notice, { color: c.text }]}>{notice}</Text>}
              <Text style={[styles.label, { color: c.text }]}>Sign in to sync your notes</Text>
              {appleSignIn && (
                <>
                  {/* Apple's own button, black on light and white on dark; remounted when the appearance changes. */}
                  <View style={{ opacity: appleBusy ? 0.6 : 1 }} pointerEvents={appleBusy || busy ? 'none' : 'auto'}>
                    <AppleAuthentication.AppleAuthenticationButton
                      key={scheme ?? 'light'}
                      buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                      buttonStyle={
                        scheme === 'dark' ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
                      }
                      cornerRadius={12}
                      onPress={() => void signInWithApple()}
                      style={styles.apple}
                      testID="apple"
                    />
                  </View>
                  <View style={styles.or} accessible={false}>
                    <View style={[styles.rule, { backgroundColor: c.line }]} />
                    <Text style={[styles.orText, { color: c.text3 }]}>or</Text>
                    <View style={[styles.rule, { backgroundColor: c.line }]} />
                  </View>
                </>
              )}
              <TextInput
                value={email}
                onChangeText={setEmail}
                onSubmitEditing={submitEmail}
                placeholder="you@example.com"
                placeholderTextColor={c.text3}
                // With Apple first, the keyboard waits until the email field is chosen.
                autoFocus={!appleSignIn}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username"
                keyboardType="email-address"
                textContentType="username"
                returnKeyType="send"
                selectionColor={c.accent}
                style={[styles.field, { color: c.text, backgroundColor: c.bgSubtle }]}
                accessibilityLabel="Email"
                testID="email"
              />
              <Button label="Send Code" busy={busy} disabled={!email.trim() || appleBusy} onPress={submitEmail} />
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
          The notes on this iPhone join your account and sync across your devices. New here? Signing in creates your account.
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
    paddingTop: 14,
    paddingBottom: 24,
    paddingHorizontal: metrics.gutter + 4
  },
  cancel: {
    alignSelf: 'flex-end',
    marginBottom: 28
  },
  cancelText: {
    fontSize: 17
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
  apple: {
    height: 50
  },
  or: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: 4
  },
  rule: {
    flex: 1,
    height: StyleSheet.hairlineWidth
  },
  orText: {
    fontSize: 13
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
