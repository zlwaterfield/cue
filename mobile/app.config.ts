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
 * have App Groups builds without it with CUE_SHARE_EXTENSION=off.
 */
const config: ExpoConfig = {
  name: 'Cue',
  slug: 'cue',
  scheme: 'cue',
  version: '0.2.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon: './assets/icon.png',
  ios: {
    bundleIdentifier: process.env.CUE_IOS_BUNDLE_ID || 'app.cue',
    appleTeamId: process.env.CUE_APPLE_TEAM_ID || undefined,
    supportsTablet: true,
    // The Icon Composer source shared with the Mac app (docs/brand/app-icon/ICON-COMPOSER.md).
    icon: '../build/Cue.icon',
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
    supabaseKey: process.env.CUE_SUPABASE_KEY ?? ''
  }
}

export default config
