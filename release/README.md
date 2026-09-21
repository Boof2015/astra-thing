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

## Assemble a preview locally

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

The repository includes a manual `.github/workflows/manager-build.yml` for tester
packages. It does not publish a GitHub release. Windows driver setup, Linux USB
permissions, clean-stock installation and platform signing remain release gates;
see [acceptance status](../docs/public-release-plan.md).
