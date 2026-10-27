# Release inputs

`version.json` identifies the Thing firmware and manager release. Astra desktop is
released independently; this work does not build or replace it.

`trusted-keys.json` contains public publisher keys only. The manager and firmware
verify the same signed release envelope before accepting a package. Signatures
cover the exact manifest bytes, including model, version, build, artifact sizes,
and SHA-256 hashes. The firmware additionally checks the exact permitted A/B
update actions and both payload hashes before invoking SWUpdate.

Private signing keys belong outside Git, backed up by the publisher. A missing
trusted publisher key makes installation unavailable; it never falls back to an
unsigned package. Production artifacts must not contain a private signing key or
device credentials.

## Local firmware, CI installers, manual publication

The firmware build stays on a Mac or Linux machine with the pinned Yocto setup.
GitHub's standard runners handle image verification and Manager packaging. No
firmware signing secret or self-hosted runner is required on GitHub.

1. Update `release/version.json`, `package.json`, `manager/package.json` and their
   lockfile versions together when changing the version. Regenerate branding if
   its SVG changed. Commit and push the release sources, including these workflows
   on the default branch. Preparation refuses an uncommitted checkout.
2. Build firmware with `npm run build:firmware`. A successful build supplies the
   ZIP, SWU and `.local/release-build.json`. A failed build must be fixed first;
   old deploy symlinks do not count as a successful new candidate.
3. Run `npm run release:prepare`. It verifies package structure, build identity
   and every staged firmware source; signs the candidate using the existing local
   `.local/signing/astra-thing-release-private.pem`; and exports project sources.
   It prints a new directory under `release-output/`.
4. Run `npm run release:draft -- "DIRECTORY_FROM_PREPARE"`. This requires `gh`
   authenticated with repository/workflow access. It checks that the commit is
   pushed, uploads a draft tagged `vVERSION-BUILD`, then dispatches **Complete
   draft release**. It never publishes. Retrying resumes missing uploads and
   refuses different bytes under the same candidate name.
5. Wait for **Complete draft release** to pass. It checks the signature, both
   first-install roots, the OTA root, production defaults, source hashes and each
   boot/OS logo. It rebuilds the Manager on macOS (Apple silicon), Windows x64 and
   Linux x64, then attaches installers, `firmware-audit.json` and final
   `SHA256SUMS` to that same draft. A failure leaves the draft unpublished; rerun
   the failed jobs from Actions after resolving the failure. Published releases
   cannot be overwritten by this workflow.
6. Test the exact draft packages, complete the remaining public release gates
   below, and edit the release notes with the compatible Astra desktop version.
   Make the repository public when ready, then publish the draft as the latest
   stable release. **Check published firmware downloads** runs the actual
   Manager download path anonymously and verifies the ZIP and SWU again.

Preparation defaults to a **stable-channel candidate**, still held in a draft.
That is intentional: publishing a draft does not change its signed manifest.
Use `npm run release:prepare -- --channel preview` for a candidate that must stay
outside the public stable feed; it creates a prerelease draft. To change channel
after signing, prepare a new candidate rather than editing `release.json`.

`release:prepare` also accepts `--key`, `--flash`, `--update`, `--build-record`
and `--output` paths. It refuses an existing output directory. Each candidate's
`provenance.json` fixes the source commit CI checks out. `project-sources.tar.gz`
must exactly match the source archive recreated in CI. The private key is never
uploaded; only its signed envelope and the public trust keys are distributed.

While the repository is private, or while a release is a draft, download its
`release.json`, ZIP and SWU together using your GitHub account, then choose the
local `release.json` in Manager. The Manager does not carry a GitHub token and
will not see private releases, drafts or prereleases in its public feed. Once a
stable release is published publicly, **Check for updates** offers it and the
normal installation/update action downloads the appropriate signed package.

`npm run release:check` repeats the anonymous feed/download check locally. It
downloads both artifacts to temporary storage, verifies their signed sizes and
hashes, then removes them. It never connects to a Thing. CI's firmware audit
checks image contents; actual booting, flashing and USB behavior still need
hardware validation.

## Low-level local assembly

Build and audit the production image first; see [image builds](../docs/image-build.md).
Use a new output directory for each candidate. Do not replace the tested files with
later build convenience symlinks.

```sh
node manager/scripts/sign-release.cjs PRIVATE_KEY FLASH_ZIP UPDATE_SWU BUILD_RECORD OUTPUT_DIRECTORY
python3 scripts/package-sources.py PROJECT_SOURCE_TAR_GZ --build-record BUILD_RECORD
npm run dist --prefix manager
```

The signing command copies the ZIP/SWU and writes `release.json` plus
`build-inputs.json`. It refuses an existing destination and verifies that the
signing key matches a trusted public key. It never publishes anything. The source
export checks every firmware input against its build record and excludes private
local data and compiled caches. This archive is the project's source, not the
complete Linux/Chromium dependency source distribution.

The publisher must keep an offline copy of the private signing key before
distributing firmware that trusts it. Keep that key out of release folders,
diagnostics, CI artifacts and source archives. OS installer signing uses separate
platform credentials.

## Public release contents

- Signed `release.json` and the exact ZIP/SWU named inside it. Mark only a tested
  stable release as the latest stable GitHub release; the manager's feed reads it.
- Platform installers built from the matching manager sources and lockfiles.
- Project sources, pinned Cargo dependency sources/build instructions, the
  corresponding Yocto/Chromium/system source materials, license manifests/SPDX
  reports and notices for bundled binary resources.
- Checksums for the whole bundle, build-input records, platform requirements,
  installation/recovery instructions and the exact required Astra desktop version.

The reusable `.github/workflows/manager-build.yml` can also be run manually for
standalone tester installers. `draft-release.yml` uses it after the firmware
audit passes; neither workflow publishes. macOS installers currently use ad-hoc
signing and Windows installers are unsigned. Windows driver setup, Linux USB
permissions, clean-stock installation, complete corresponding dependency sources
and platform signing remain release gates; see [acceptance status](../docs/public-release-plan.md).
