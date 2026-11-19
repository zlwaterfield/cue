# PR #87 test run (iPhone Duo layout)

Screenshots and the browser harness used to exercise PR #87 without an iOS simulator.
The app's React Native code is bundled for react-native-web and driven by Playwright;
`harness/` holds the stubs (SQLite, safe-area insets, keyboard, secure store), the Metro
config that swaps them in, and `run.js`, the scripted flows. `results.json` is its output.
