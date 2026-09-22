# Capacitor / native configuration (Android + iOS)

This folder holds the **native-side configuration that Capacitor does not generate
for you**: the permissions, usage descriptions, deep-link intent filters and build
notes that turn the generated projects into a shippable app.

The generated projects themselves live in `app/android` and `app/ios` (created by
`npx cap add android` / `npx cap add ios`). They are generated, not hand-written —
but the edits below **must be applied to them**, because Capacitor regenerates the
project scaffolding on `cap add` only, and never overwrites these files afterwards.
`npx cap sync` copies `app/www` into them and does not touch your edits.

```
app/
  capacitor.config.json   <- appId, appName, webDir, plugin settings (checked in)
  android/                <- generated Android Studio / Gradle project
  ios/                    <- generated Xcode project
capacitor/                <- this folder: the manual native edits + reference files
  android/
  ios/
```

## Why there is nothing to compile here

This machine has **no JDK, no Android SDK and is not macOS**, so an APK/AAB and an
IPA cannot be produced from it. Everything that *can* be prepared on any platform —
the config, the permission manifests, the icons, the splash, the build commands — is
prepared here. The build commands are in the root `README.md` under
*Building the native apps*.

---

## Android edits

### 1. `app/android/app/src/main/AndroidManifest.xml`

Add these, inside `<manifest>`:

```xml
<!-- Camera: used to photograph a scene. Requested at the moment of use, never at launch. -->
<uses-permission android:name="android.permission.CAMERA" />
<uses-feature android:name="android.hardware.camera" android:required="false" />
<uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />

<!-- Reading a chosen screenshot. Android 13+ uses the granular media permission. -->
<uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE"
    android:maxSdkVersion="32" />

<!-- Connectivity state, for the offline banner. -->
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
```

`uses-feature ... required="false"` matters: without it, Play Store filters the app
off tablets and Chromebooks that have no rear camera.

### 2. Deep links back into the app (optional, for the password reset link)

Inside the main `<activity>`:

```xml
<intent-filter android:autoVerify="true">
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="https" android:host="app.cinza.example" android:pathPrefix="/reset" />
</intent-filter>
```

The server's reset link is `${API_URL}/reset?token=…`; on a phone this should hand
back to the app. Register the app's own domain in
`app/android/app/src/main/res/values/strings.xml` and in `capacitor.config.json`
under `server.hostname` if you want a custom scheme instead.

### 3. Colours (status bar + splash background)

`app/android/app/src/main/res/values/colors.xml`:

```xml
<resources>
    <color name="colorPrimary">#08090B</color>
    <color name="colorPrimaryDark">#08090B</color>
    <color name="colorAccent">#C8342B</color>
    <color name="splashBackground">#08090B</color>
</resources>
```

### 4. Icon + splash

Use `@capacitor/assets` (one command, generates every density and both platforms):

```bash
# from the repository root
npm i -D @capacitor/assets

# put these two files in app/assets/  (1024x1024 PNG, no transparency on the icon)
#   app/assets/icon-only.png
#   app/assets/splash.png            (2732x2732 PNG, artwork centred, dark #08090B fill)
npx capacitor-assets generate --android --ios
```

The mark to export is `app/assets/img/logo.svg` — a viewfinder frame around a
three-blade iris. Do not replace it with the platform default: the default Capacitor
icon ships in the branding of a different product.

### 5. Release signing

Never commit a keystore. Create one on your own machine and reference it from
`app/android/keystore.properties` (which `.gitignore` already excludes):

```properties
storeFile=../../cinza-release.jks
storePassword=…
keyAlias=cinza
keyPassword=…
```

Then in `app/android/app/build.gradle`:

```gradle
def keystoreProperties = new Properties()
def keystorePropertiesFile = rootProject.file('keystore.properties')
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}

android {
    signingConfigs {
        release {
            if (keystorePropertiesFile.exists()) {
                storeFile file(keystoreProperties['storeFile'])
                storePassword keystoreProperties['storePassword']
                keyAlias keystoreProperties['keyAlias']
                keyPassword keystoreProperties['keyPassword']
            }
        }
    }
    buildTypes {
        release {
            signingConfig keystorePropertiesFile.exists() ? signingConfigs.release : null
            minifyEnabled true
            shrinkResources true
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }
}
```

---

## iOS edits

### 1. `app/ios/App/App/Info.plist`

Every one of these strings is shown verbatim to the user in the permission dialog, so
they say what the app is doing and nothing else:

```xml
<key>NSCameraUsageDescription</key>
<string>CINZA uses the camera so you can photograph a scene and identify the film or series.</string>

<key>NSPhotoLibraryUsageDescription</key>
<string>CINZA reads a screenshot you choose so it can identify the film or series in it.</string>

<key>NSPhotoLibraryAddUsageDescription</key>
<string>CINZA can save an identified still to your photo library.</string>

<key>NSMicrophoneUsageDescription</key>
<!-- Only if you ever capture video with audio. The app does not record audio;
     omit this key entirely if that stays true, because asking for a permission
     you do not use is a review rejection. -->

<key>NSAppTransportSecurity</key>
<dict>
    <!-- Required ONLY when pointing a debug build at a plain-http dev server.
         The production API must be https. Remove this block for release. -->
    <key>NSAllowsLocalNetworking</key>
    <true/>
</dict>

<key>UIRequiredDeviceCapabilities</key>
<array>
    <string>armv7</string>
</array>

<key>UISupportedInterfaceOrientations</key>
<array>
    <string>UIInterfaceOrientationPortrait</string>
</array>

<key>ITSAppUsesNonExemptEncryption</key>
<false/>
```

`ITSAppUsesNonExemptEncryption=false` is correct here: the app uses only standard
HTTPS, which is exempt. Setting it avoids an export-compliance prompt on every
TestFlight upload.

### 2. `app/ios/App/Podfile`

Uncomment the permissions block so the plugins' usage descriptions are wired up:

```ruby
def capacitor_pods
  pod 'Capacitor', :path => '../../node_modules/@capacitor/ios'
  pod 'CapacitorCordova', :path => '../../node_modules/@capacitor/ios'
end

target 'App' do
  capacitor_pods
  # Add your Pods here
end
```

Then:

```bash
cd app/ios/App && pod install
```

### 3. Bundle identifier

Set `PRODUCT_BUNDLE_IDENTIFIER = app.cinza.mobile` in
`app/ios/App/App.xcodeproj/project.pbxproj` — or, more simply, open the project in
Xcode, select the **App** target, and set it under *Signing & Capabilities*. Keep it
identical to `appId` in `capacitor.config.json`; the App Store rejects a mismatch.

Also set a **Team** and enable *Automatically manage signing* there. A build cannot
be signed without an Apple Developer account.

### 4. Orientation and dark UI

`UIViewControllerBasedStatusBarAppearance = false` plus
`UIStatusBarStyle = UIStatusBarStyleLightContent` keeps the light status bar icons on
the near-black background. The app already paints `#08090B` behind the webview via
`ios.backgroundColor` in `capacitor.config.json`.

---

## Web layer prerequisites this depends on

These are already implemented in `app/www`; listed so the native behaviour is
verifiable:

| Requirement | Where it lives |
|---|---|
| Safe-area insets for notch / Dynamic Island / home indicator | `env(safe-area-inset-*)` in `app/css/tokens.css`, applied in `layout.css` |
| Hardware back button handling | `app/js/main.js` → `CapacitorApp.addListener('backButton')` |
| Status bar + splash control | `app/js/main.js` → `StatusBar.setStyle`, `SplashScreen.hide` |
| Camera permission requested at the moment of use | `app/js/services/media.js` → `ensureCameraPermission()` |
| Secure token storage | `app/js/services/secureStore.js` — Keychain/Keystore when the plugin is present |
| Video: frames extracted on-device | `app/js/services/video.js` |
| Deep-linkable routes | hash routing in `app/js/core/router.js` |

## Optional: encrypted token storage

```bash
npm i capacitor-secure-storage-plugin -w cinza-app
npx cap sync
```

Without it, tokens are stored via `@capacitor/preferences`, which is app-private on
both platforms but **not encrypted**. The About screen reports which of the two is
actually in use, so this is verifiable rather than assumed.
