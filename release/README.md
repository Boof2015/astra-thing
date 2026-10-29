# Firmware and Manager releases

Firmware and Manager share this repository but have separate releases and versions.

| Release | Tag | How it is prepared |
| --- | --- | --- |
| Firmware | `firmware-vVERSION-BUILD` | Build and sign locally; upload files manually |
| Manager | `manager-vVERSION` | Manually run CI; installers are attached to a draft |

## Firmware: build, sign, upload

1. Set the firmware version in `release/version.json`. Its `minimumManager` field
   identifies the oldest compatible Manager; the two versions do not need to match.
2. Build and test the image using the [firmware instructions](../docs/image-build.md).
   Audit the ZIP/SWU on Linux, including the roots and boot artwork, and test on
   hardware before publishing. A successful build provides `.local/release-build.json`.
3. Run `npm run release:prepare`. This checks the firmware, signs it with the local
   publisher key and exports its sources and build records to `release-output/`.
   For files copied from another builder, pass `--flash`, `--update` and
   `--build-record`. Use `--output` for a new destination if a candidate already exists.
4. Create a GitHub release with the tag printed by that command, for example
   `firmware-v0.3.0-20261029190555`. Upload these three files from the output directory:
   - `release.json`
   - the `.zip` named in that manifest (first-time installation)
   - the `.swu` named in that manifest (existing-device updates)
5. Attach `project-sources.tar.gz` as the fourth download. Keep `build-inputs.json`,
   `provenance.json`, audit reports and `SHA256SUMS` in the local candidate folder;
   Manager does not download them, and `release.json` already contains the signed
   firmware hashes. Put release notes in GitHub's release description, not an asset.
   Add the compatible Astra desktop version and corresponding dependency source
   links to those notes. Publish when ready. No Manager build is triggered.

Already signed firmware does not need rebuilding or re-signing when only Manager
changes. The signed manifest, ZIP and SWU must stay together without editing or
renaming their contents. `provenance.json` records the source revision used when
preparing the archive; it does not control Manager CI.

Preparation defaults to the stable channel. For preview-only firmware, use
`--channel preview` and mark its GitHub release as a prerelease. Manager ignores
previews and drafts during automatic checks. To test either locally, keep
`release.json`, ZIP and SWU together and choose that `release.json` in Manager.

The private key stays in `.local/signing/astra-thing-release-private.pem` or the
path supplied with `--key`. Keep a separate private backup. Only the signed
manifest and public trust keys are distributed. `release:prepare` never uploads,
publishes or flashes anything.

## Manager: CI to a draft

1. Update `manager/package.json` and its lockfile when changing the Manager version.
   Commit and push the Manager changes. Firmware versions and files stay independent.
2. Open **Actions → Build Manager draft release → Run workflow** on the desired branch.
3. CI tests and builds the macOS DMG, Windows installer and Linux AppImage/deb,
   then attaches them and `SHA256SUMS` to a `manager-vVERSION` draft.
4. Download and test the installers, edit the notes and publish when ready.

This workflow runs only when manually dispatched. It does not need a firmware
release, signing key, firmware audit or matching firmware version. Rerunning it
refreshes the same unpublished Manager draft. It refuses to replace a published
release; bump the Manager version for the next release.

## How Manager finds firmware

Manager lists GitHub releases, ignores Manager releases, drafts and prereleases,
then selects the most recently **published** stable `firmware-vVERSION-BUILD`
release. This works across release-list pages and does not depend on GitHub's
"latest" badge. The tag must match the version and build in the signed manifest.

It verifies the publisher signature, minimum Manager version, expected sizes and
checksums before installation. An invalid or incomplete newest firmware release
is reported as an error rather than silently selecting an older image.

After publishing firmware, `npm run release:check` can manually exercise the same
anonymous discovery/download path. It checks both packages and contacts no
hardware. No workflow is triggered by publishing either kind of release.

## Validation and source materials

`npm run release:verify -- DIRECTORY --audit` repeats the signature and full image
audit on Linux with the matching firmware sources. Manager-only source changes
and different Manager versions do not invalidate that firmware candidate.

Make matching project and dependency sources/notices available with each release;
link any separately hosted materials in its notes. Keep build records locally.
`project-sources.tar.gz`
contains this project's source, not the complete Linux/Chromium dependency source
distribution. See [acceptance status](../docs/public-release-plan.md) for remaining
hardware/platform checks and installer signing status.
