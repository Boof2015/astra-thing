# Public firmware and device manager

## Scope

Astra Thing firmware and a standalone guided manager for Windows, macOS and Linux. Astra desktop support ships separately in Astra's next release. The client and manager use GPL-3.0-only; dependencies retain their licenses.

The approved hardware illustrations and installation flow are implemented in `manager/`. `design-preview/manager.html` remains an offline simulation.

## Implemented

- Real USB detection, explicit selection for multiple devices, and illustrated recovery instructions.
- Stock backup of 16 readable partitions, with two device reads and saved-file verification. The backup belongs to the selected USB session. Protected chip regions are outside its coverage.
- Signed release manifests, bounded downloads, artifact hashes, ZIP/GPT/flash-action checks and explicit installation review.
- USB-only HTTPS management, matching-code approval on the Thing, certificate pinning before credentials are sent, and manager revocation on the Thing. Music pairing stays separate.
- Inactive-slot updates with independent on-device signature/payload checks, raw partition readback, reboot and expected-version/operation/health confirmation.
- Persistent operation records, failed-boot rollback handling, diagnostics without credentials, and restart controls.
- Production image with the immutable release client, kiosk configuration, Astra boot art, display heartbeat and boot watchdog. SSH, ADB, VNC and Chromium remote debugging are absent or disabled.
- macOS DMG, Windows NSIS and Linux AppImage/deb build targets, bundled native worker/libusb, and a manual CI build workflow.

## Validation on 2026-09-12

Node manager, Python client/management and Rust worker tests pass. They cover signature tampering, unsafe package paths, certificate changes without credential disclosure, physical-approval protocol agreement, interrupted operations and startup confirmation.

The actual extracted release rootfs is checked against source hashes, kiosk configuration, production defaults and credential absence. The included ARM Python maintenance modules have been smoke-tested in the extracted image.

The development-to-release migration preserved the owner's theme, music pairing and controls. Matching-code authorization on the actual Thing works, and reopening the manager reconnects with saved access. A normal manager update completed with the expected running build, operation and health confirmation. That test exposed a too-short response timeout during on-device package verification; the manager now allows that verification time and reconciles an authenticated operation after a lost response.

A candidate missing its Weston kiosk configuration failed to reach the app. Automatic boot retries restored the previous slot on the physical device. The missing package was added and the audit now rejects that omission.

The Apple silicon DMG builds locally. Its packaged app detected the Thing, reused approved access, installed build `20260912224043`, and confirmed the expected build, healthy startup and completed operation. Closing and reopening the packaged manager after upload resumed the pending update successfully. Its macOS permission metadata and launcher UUID are set before signing; public Developer ID signing/notarization remains outstanding. Packaging success does not establish compatibility on another OS or architecture.

## Windows discovery update on 2026-09-21

The manager adapts Astra commit `0c32125` for browsing: explicit mDNS sockets on attached Thing USB IPv4 interfaces, five-second interface reconciliation and repeat queries, independent socket failure/retry handling, and removal of stale endpoints. Direct USB-address probing remains enabled. No firmware changes are required.

All 26 manager tests pass locally, including real Bonjour/DNS packet processing over a controlled datagram transport, USB hotplug/address changes with competing adapters, and socket setup failures. The Windows CI job now runs the discovery and controller regression tests; that job and physical Windows validation have not been run here. Rebuild the Windows manager from these sources before testing. The saved September 12 preview binaries and source archive predate this change.

## Updated boot branding on 2026-10-26

The shared logo now matches the redesigned Thing Manager: blue icon and rounded white wordmark. `npm run build:branding` regenerates the Manager header copy, app startup copy, 800×480 OS splash and correctly rotated 480×800 RGB565 boot logo. The renderer reads the SVG viewBox rather than assuming the old logo's proportions. The output headers/hashes and all rotated boot pixels were checked locally.

A fresh production build was attempted, but the existing Yocto build volume contains stale shared outputs: cached tasks report files already present without matching task ownership. The build container was stopped; no new firmware package was verified or signed. Keep the September preview separate. Repair or rebuild the generated Yocto output directory while retaining downloads and shared-state cache, then audit and sign a new candidate before distributing the updated boot logo.

The next acceptance sequence is Windows testing, then a nontechnical tester installing on a stock Car Thing using the packaged Manager and matching signed firmware. Record where they hesitate, need outside help, or encounter unclear errors, and revise the instructions before public release.

## Gates before public release

The local-firmware/CI-installer release flow is implemented: prepare and sign a
candidate locally, upload it to a draft, audit its images on Ubuntu, build the
three Manager platforms, and attach the installers without publishing. A separate
workflow checks anonymous Manager downloads after stable publication. No private
signing key enters CI. The repository must be public for the Manager feed to work.

Local validation covers 32 Manager tests, 13 UI tests and 22 Python tests. The
image audit passed against the saved September firmware inside Ubuntu 24.04 as
an unprivileged user, including both first-install roots, the update root and
their boot/splash branding. Workflow syntax passed actionlint. A full GitHub run
with a fresh branded candidate and real published downloads remains pending;
these local checks do not claim those remote steps have passed.

1. Run the whole first-install wizard on a stock device and a clean host profile. Earlier developer backup/flash work is not a substitute for this test.
2. Finish and validate guided Windows recovery-driver setup and Linux USB permissions. Exercise networking, discovery, backup, flash and reconnect on all advertised OS versions. Intel macOS needs its own build/test.
3. Exercise physical disconnect and low-storage cases. Manager restart after a completed upload has passed; forced interruption during transfer still needs hardware coverage. Keep recovery instructions tied to observed results. Return-to-stock restoration remains unvalidated.
4. Sign/notarize public installers as appropriate. Back up the private firmware signing key separately; never include it in source or binary packages.
5. Assemble corresponding dependency/firmware sources, generated license/SPDX reports and binary-resource notices, matched to the tested binaries.
6. Set the exact compatible Astra desktop release, publish matching source/build records, then publish the signed firmware assets and platform installers.

No public release has been published. See [platform setup](manager-platforms.md), [firmware builds](image-build.md) and [release assembly](../release/README.md). This preview does not claim that clean-host or cross-platform gates have passed.
