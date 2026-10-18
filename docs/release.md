# Release runbook (Play internal testing)

The agent never uploads, logs in to Expo or Google, or stores credentials. Every step below is a
person's step. Signing keys and the Play service-account key stay outside the repository.

## Build configuration

- `apps/mobile/eas.json`: the `production` profile builds a signed `.aab` with the real BLE
  transport. `versionCode` is kept by EAS (`appVersionSource: remote`, `autoIncrement`), so a code
  is never reused. The user-visible version is `expo.version` in `apps/mobile/app.json`.
- Signing: EAS creates and stores the upload keystore on the first `eas build`. Play App Signing
  holds the app signing key, so a lost upload key can be reset through Play support.
- Permissions: the release manifest asks for Bluetooth only. `INTERNET` is removed from the
  release variant by `apps/mobile/plugins/with-release-no-internet.js`; debug builds keep it
  because Metro needs it. Unused Expo defaults are blocked in `app.json`.
  If the app is ever found to need `INTERNET`, drop the plugin and update the wording here and in
  the human checks; the privacy policy claims behaviour ("makes no network requests"), not a permission.

## First build

1. `cd apps/mobile && pnpm dlx eas-cli login`
2. `pnpm dlx eas-cli init` — writes `extra.eas.projectId` and `owner` into `app.json`. Commit them
   (they are not secrets).
3. `pnpm dlx eas-cli build -p android --profile production`. Accept that EAS generates the keystore.
4. Download the `.aab` from the build page.

If the cloud build fails because of pnpm or the monorepo layout, use `eas build --local` and record
the cause in the change's deviations.

## First upload (manual)

Google requires the first upload of a new app to be done by hand.

1. Play Console → create the app → Testing → Internal testing → Create release → upload the `.aab`.
2. Add testers (an e-mail list) and copy the opt-in link.
3. Later releases: `eas submit -p android --profile production` with a service-account key kept
   outside the repo (never set `serviceAccountKeyPath` in a committed file). The profile submits to
   `internal` as a draft; promotion stays in the Play Console.

## Publish the policy

Play needs a public, non-geofenced URL (not a PDF) as well as the in-app text.

1. Publish `docs/privacy-policy.md` where you prefer (for example GitHub Pages or Google Sites).
   The repository is private, so a link to the file in it is not public.
2. Enter the URL in the Play Console (App content → Privacy policy) and write it under *Play
   Console forms* below.
3. Open it in a private browser window and confirm that it loads without login.
4. The in-app copy (Settings → Privacy policy) comes from the catalog; a unit test keeps it equal to
   the document. Change both together.

## Play Console forms

- **Data safety:** "no data collected", "no data shared" (matches the privacy policy).
- **Privacy policy:** public URL of `docs/privacy-policy.md` (published by a person, not a PDF,
  no login). URL: _not published yet_.

## Switching between CI APKs and Play builds

CI APKs are signed with the debug keystore, Play builds with the Play signing key. They share the
application id, so installing one over the other fails. Export your data (Settings), uninstall
Guardian, then install the other build.

## Pilot checklist (sign off before inviting testers)

- [ ] AAB accepted by the Play Console internal track (FR-20 AC1).
- [ ] Installed from the Play internal link; the app info screen lists no network permission.
- [ ] Privacy policy public URL entered in the Play Console and opens without login (FR-20 AC2).
- [ ] Data safety form filled to match the policy.
- [ ] Real-hardware BLE checks from `context/test-plan.md` done on the mid-range phone.
- [ ] Second phone (Android 12, other vendor) walkthrough done.
- [ ] Accessibility checks on the phone (`docs/accessibility-audit.md`).
- [ ] Performance check on the phone (`docs/performance.md`).
