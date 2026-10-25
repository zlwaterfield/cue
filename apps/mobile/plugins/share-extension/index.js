const fs = require('node:fs')
const path = require('node:path')
const plist = require('@expo/plist').default
const { withDangerousMod, withEntitlementsPlist, withInfoPlist, withXcodeProject } = require('expo/config-plugins')

/**
 * Cue in the iOS share sheet: a small share extension (`ShareViewController.swift`) that
 * leaves what was shared in an app group, for the app to add to today.
 *
 * The extension's bundle ID is the app's plus `.share`, and the app group is
 * `group.<app bundle ID>`, so a personal bundle ID (CUE_IOS_BUNDLE_ID) gets its own of
 * both. Both targets read the group's name from `CueAppGroup` in their Info.plist.
 */

const TARGET = 'CueShare'
const SOURCE = path.join(__dirname, 'ShareViewController.swift')

function groupOf(config) {
  return `group.${config.ios.bundleIdentifier}`
}

const withAppGroup = (config) => {
  config = withEntitlementsPlist(config, (c) => {
    const groups = new Set(c.modResults['com.apple.security.application-groups'] ?? [])
    groups.add(groupOf(c))
    c.modResults['com.apple.security.application-groups'] = [...groups]
    return c
  })
  return withInfoPlist(config, (c) => {
    c.modResults.CueAppGroup = groupOf(c)
    return c
  })
}

const withExtensionFiles = (config) =>
  withDangerousMod(config, [
    'ios',
    (c) => {
      const dir = path.join(c.modRequest.platformProjectRoot, TARGET)
      fs.mkdirSync(dir, { recursive: true })
      fs.copyFileSync(SOURCE, path.join(dir, 'ShareViewController.swift'))
      fs.writeFileSync(
        path.join(dir, 'Info.plist'),
        plist.build({
          CFBundleDevelopmentRegion: '$(DEVELOPMENT_LANGUAGE)',
          CFBundleDisplayName: c.name,
          CFBundleExecutable: '$(EXECUTABLE_NAME)',
          CFBundleIdentifier: '$(PRODUCT_BUNDLE_IDENTIFIER)',
          CFBundleInfoDictionaryVersion: '6.0',
          CFBundleName: '$(PRODUCT_NAME)',
          CFBundlePackageType: '$(PRODUCT_BUNDLE_PACKAGE_TYPE)',
          CFBundleShortVersionString: c.version,
          CFBundleVersion: c.ios.buildNumber ?? '1',
          CueAppGroup: groupOf(c),
          NSExtension: {
            NSExtensionAttributes: {
              NSExtensionActivationRule: {
                NSExtensionActivationSupportsWebURLWithMaxCount: 1,
                NSExtensionActivationSupportsText: true
              }
            },
            NSExtensionPointIdentifier: 'com.apple.share-services',
            NSExtensionPrincipalClass: '$(PRODUCT_MODULE_NAME).ShareViewController'
          }
        })
      )
      fs.writeFileSync(
        path.join(dir, `${TARGET}.entitlements`),
        plist.build({ 'com.apple.security.application-groups': [groupOf(c)] })
      )
      return c
    }
  ])

const withExtensionTarget = (config) =>
  withXcodeProject(config, (c) => {
    const project = c.modResults
    if (project.pbxTargetByName(TARGET)) return c

    const bundleId = `${c.ios.bundleIdentifier}.share`
    const target = project.addTarget(TARGET, 'app_extension', TARGET, bundleId)

    // Its files, in a group of their own.
    const group = project.addPbxGroup(['ShareViewController.swift', 'Info.plist', `${TARGET}.entitlements`], TARGET, TARGET)
    const mainGroup = project.getFirstProject().firstProject.mainGroup
    project.addToPbxGroup(group.uuid, mainGroup)

    // Only the Swift file is built; the plist and entitlements are read through build settings.
    const buildFiles = project.pbxBuildFileSection()
    for (const key of Object.keys(buildFiles)) {
      const comment = buildFiles[`${key}_comment`]
      if (comment === 'Info.plist in Resources' || comment === `${TARGET}.entitlements in Resources`) {
        const ref = buildFiles[key].fileRef
        if (group.pbxGroup.children.some((child) => child.value === ref)) {
          delete buildFiles[key]
          delete buildFiles[`${key}_comment`]
        }
      }
    }

    project.addBuildPhase(['ShareViewController.swift'], 'PBXSourcesBuildPhase', 'Sources', target.uuid)
    project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', target.uuid)
    project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid)

    // The app builds and embeds the extension: name the copy phase the way Xcode does.
    const objects = project.hash.project.objects
    objects.PBXTargetDependency ??= {}
    objects.PBXContainerItemProxy ??= {}
    project.addTargetDependency(project.getFirstTarget().uuid, [target.uuid])
    const phases = project.hash.project.objects.PBXCopyFilesBuildPhase ?? {}
    for (const [key, phase] of Object.entries(phases)) {
      if (typeof phase === 'object' && phase.name === '"Copy Files"' && phase.dstSubfolderSpec === 13) {
        phase.name = '"Embed Foundation Extensions"'
        phases[`${key}_comment`] = 'Embed Foundation Extensions'
      }
    }

    // Build settings, matching the app's deployment target and signing team.
    const appSettings = Object.values(project.pbxXCBuildConfigurationSection()).find(
      (s) => typeof s === 'object' && s.buildSettings?.PRODUCT_BUNDLE_IDENTIFIER?.replace(/"/g, '') === c.ios.bundleIdentifier
    )?.buildSettings
    const configurations = project.pbxXCConfigurationList()[target.pbxNativeTarget.buildConfigurationList].buildConfigurations
    for (const { value } of configurations) {
      const settings = project.pbxXCBuildConfigurationSection()[value].buildSettings
      Object.assign(settings, {
        CLANG_ENABLE_MODULES: 'YES',
        CODE_SIGN_ENTITLEMENTS: `${TARGET}/${TARGET}.entitlements`,
        CODE_SIGN_STYLE: 'Automatic',
        CURRENT_PROJECT_VERSION: c.ios.buildNumber ?? '1',
        GENERATE_INFOPLIST_FILE: 'NO',
        INFOPLIST_FILE: `${TARGET}/Info.plist`,
        IPHONEOS_DEPLOYMENT_TARGET: appSettings?.IPHONEOS_DEPLOYMENT_TARGET ?? '16.4',
        LD_RUNPATH_SEARCH_PATHS: '"$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"',
        MARKETING_VERSION: c.version,
        PRODUCT_BUNDLE_IDENTIFIER: `"${bundleId}"`,
        PRODUCT_NAME: '"$(TARGET_NAME)"',
        SKIP_INSTALL: 'YES',
        SWIFT_VERSION: '5.0',
        TARGETED_DEVICE_FAMILY: '"1,2"'
      })
      if (c.ios.appleTeamId) settings.DEVELOPMENT_TEAM = c.ios.appleTeamId
    }
    return c
  })

module.exports = function withShareExtension(config) {
  return withExtensionTarget(withExtensionFiles(withAppGroup(config)))
}
