import { Alert, Linking, Platform } from 'react-native'
import Constants from 'expo-constants'
import { reportIssueUrl } from '@shared/feedback'
import { PRIVACY_URL, TERMS_URL } from '@shared/terms'
import { Row, Section, SettingsScreen } from '../../ui/SettingsList'

/** Where to report something, and the terms you signed up to. */
export default function About() {
  const version = Constants.expoConfig?.version ?? '1.0.0'
  const reportIssue = (): void => {
    void Linking.openURL(reportIssueUrl(`iPhone, version ${version} (iOS ${Platform.Version})`)).catch(() => {
      Alert.alert('Couldn’t open GitHub', 'Please try again.')
    })
  }
  return (
    <SettingsScreen title="About & Help">
      <Section footnote="Opens a new issue on GitHub with your version filled in.">
        <Row label="Report an Issue…" onPress={reportIssue} />
      </Section>

      <Section>
        <Row label="Terms of Service" onPress={() => void Linking.openURL(TERMS_URL)} />
        <Row label="Privacy Policy" onPress={() => void Linking.openURL(PRIVACY_URL)} />
      </Section>

      <Section>
        <Row label="Version" value={`${version} · beta`} />
      </Section>
    </SettingsScreen>
  )
}
