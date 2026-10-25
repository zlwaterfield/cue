import { Linking, Share } from 'react-native'
import { router } from 'expo-router'
import { ASSISTANTS_URL, assistantUrls } from '@shared/assistants'
import { sync } from '../../core/app'
import { useStore } from '../../core/store'
import { Row, Section, SettingsScreen } from '../../ui/SettingsList'

/**
 * The URL an assistant connects to over MCP, and how. An assistant works with the account,
 * not this iPhone, so until sync is on the screen says so and offers to turn it on. The
 * assistant is usually on another device, so the URL goes to the share sheet, which can
 * copy it or AirDrop it to the Mac. The URL is the build's sync server's
 * (`assistantUrls`). The words are the Mac's.
 */
export default function Assistants() {
  const state = useStore(sync.state, (s) => s)
  if (!state.server) return null
  const { mcp, connected } = assistantUrls(state.server)

  return (
    <SettingsScreen title="Assistants">
      {state.email ? (
        <Section
          title="MCP server URL"
          footnote={`Add it as a custom connector in Claude, ChatGPT or another assistant, then sign in as ${state.email} and press Allow.`}
        >
          <Row label={mcp} action="Share" onPress={() => void Share.share({ url: mcp })} />
        </Section>
      ) : (
        <>
          <Section footnote="An assistant connects to your Cue account, not to this iPhone, so it only works once sync is on and you’re signed in.">
            <Row label={state.previousEmail ? 'Sign In Again…' : 'Turn On Sync…'} onPress={() => router.push('/sign-in')} />
          </Section>
          <Section title="MCP server URL" footnote="Once sync is on, add it as a custom connector in Claude, ChatGPT or another assistant.">
            <Row label={mcp} />
          </Section>
        </>
      )}

      <Section footnote="What an assistant can and can’t do with your days.">
        <Row label="How It Works" onPress={() => void Linking.openURL(ASSISTANTS_URL)} />
        {state.email && connected && <Row label="Connected Assistants…" onPress={() => void Linking.openURL(connected)} />}
      </Section>
    </SettingsScreen>
  )
}
