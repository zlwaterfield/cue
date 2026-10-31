import type { ExpoConfig } from 'expo/config'

/**
 * Cue for iPhone. The sync server is required here (there's no local-only mode), so a
 * build needs CUE_SUPABASE_URL and CUE_SUPABASE_KEY, the same variables the Mac app uses
 * (docs/SYNC.md). They're read from the environment or `.env.development.local` when Metro
 * or a Debug build starts, and `.env.production.local` for a Release build.
 *
 * Signing for a real iPhone is personal, so it comes from there too: CUE_APPLE_TEAM_ID,
 * and CUE_IOS_BUNDLE_ID if `app.cue` isn't available to your team. The share extension
 * signs as `<bundle ID>.share` with the App Group `group.<bundle ID>`; a team that can't
 * have App Groups builds without it with CUE_SHARE_EXTENSION=off. Sign in with Apple needs
 * a paid Apple Developer team too; a free Personal Team builds with CUE_APPLE_SIGN_IN=off,
 * which leaves sign-in to email codes.
 */
const appleSignIn = process.env.CUE_APPLE_SIGN_IN !== 'off'

const config: ExpoConfig = {
  name: 'Cue',
  slug: 'cue',
  scheme: 'cue',
  // The App Store only takes numbers here, so the iPhone is 1.0.0 while the Mac is 1.0.0-beta.3.
  version: '1.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon: './assets/icon.png',
  ios: {
    bundleIdentifier: process.env.CUE_IOS_BUNDLE_ID || 'app.cue',
    // Each upload to App Store Connect needs a new one; scripts/testflight.mjs sets it.
    buildNumber: process.env.CUE_IOS_BUILD_NUMBER || '1',
    appleTeamId: process.env.CUE_APPLE_TEAM_ID || undefined,
    supportsTablet: true,
    // The Icon Composer source shared with the Mac app (brand/app-icon/ICON-COMPOSER.md).
    icon: '../desktop/build/Cue.icon',
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      // A development sync server on this Mac (http://127.0.0.1:54321) is plain HTTP.
      NSAppTransportSecurity: { NSAllowsLocalNetworking: true }
    }
  },
  plugins: [
    'expo-router',
    'expo-sqlite',
    'expo-secure-store',
    ...(appleSignIn ? ['expo-apple-authentication'] : []),
    // "Cue" in the share sheet: a shared link or text becomes a new line in today. It needs
    // the App Groups capability; CUE_SHARE_EXTENSION=off builds without it.
    ...(process.env.CUE_SHARE_EXTENSION === 'off' ? [] : ['./plugins/share-extension']),
    [
      'expo-splash-screen',
      {
        image: './assets/splash-light.png',
        imageWidth: 44,
        backgroundColor: '#FFFFFF',
        dark: { image: './assets/splash-dark.png', backgroundColor: '#18181A' }
      }
    ]
  ],
  experiments: { typedRoutes: false },
  extra: {
    supabaseUrl: process.env.CUE_SUPABASE_URL ?? '',
    supabaseKey: process.env.CUE_SUPABASE_KEY ?? '',
    appleSignIn
  }
}

export default config
