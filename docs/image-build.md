# Astra Thing image and boot branding

The Astra layer lives in `meta-astra-thing/`. It extends the pinned Superbird kiosk BSP with the supplied Astra icon + wordmark, an Astra distro identity, the working companion client and its Python runtime dependencies, and an A/B system update package. Main Astra's desktop integration is built separately.

## Artwork

`branding/astra-full.svg` is the shared vector artwork, updated to the blue icon and rounded white wordmark used by the redesigned Thing Manager. The image renderer reads its viewBox, preserves its origin and aspect ratio, and places it at 520 px wide, centered on a black 800×480 canvas (with a 280 px height limit for unusually tall future artwork). It exports:

- `branding/generated/splash.png`: the 800×480 Weston splash.
- `branding/generated/logo.bmp`: the same canvas rotated clockwise into the panel's native 480×800 orientation, encoded as a 16-bit RGB565 BMP.
- `prototype/web/assets/astra-full.svg`: the matching app startup lockup.
- `manager/renderer/astra-wordmark.svg`: the matching Manager header lockup.
- `branding/generated/manifest.json`: the input/output hashes and rendering geometry.

The app boot page uses the same width and black background. Update the shared SVG in `branding/` and regenerate all copies from there:

```sh
npm ci --prefix tools/branding
npm run build:branding
```

Only the vector paths are rendered; there is no font dependency or generative image step. The image build rejects changed/mismatched branding assets until the manifest is regenerated.

## Build

Use the same prerequisites and pinned checkout described in `bringup.md`: Docker, the kas 5.5 environment, `just`, the Mac GNU coreutils shims where applicable, and the BSP revision/container digest in `config/bringup-toolchain.json`.

```sh
npm run build:firmware:dev
```

The script checks the upstream revision and tracked modifications, stages only `meta-astra-thing`, `prototype` and `branding` into the container, then builds `config/astra-image.yml`. It does not flash or contact a device. Private `.local` files, backups and device state are never staged as recipe inputs. The existing Docker volume is reused for incremental builds.

The targets are:

- `astra-thing-dev-image`: complete first-install Flashthing ZIP and squashfs/WIC image.
- `astra-thing-update-dev`: a full SWUpdate `.swu` containing `boot.vfat` and the squashfs system image for the inactive slot.

The root image and initial bandaid filesystem contain the client. The existing `/opt/superbird-kiosk` vendor/service paths are retained for compatibility with already-configured devices. The initial kiosk URL is `http://127.0.0.1:8080`; a clean install starts at setup with no pairing. Existing app overlays are retained during a system update, and can be updated with `scripts/deploy-player.sh`.

The Astra boot-vfat append fixes an upstream difference: WIC first-install images include `logo.bmp`, but the upstream OTA boot-vfat recipe omitted it. The Astra recipe includes the logo before generating both full and delta boot artifacts. The Astra SWUpdate description includes SHA-256 checks for both payloads.

## Verify before installation

The mirrored artifacts are under `.local/yocto-superbird/build/tmp/deploy/images/superbird/`. Keep a dated private copy before later builds replace the convenience links.

```sh
python3 scripts/verify-kiosk-image.py path/to/astra-thing-dev-image-flashthing.zip --image astra-thing-dev-image
python3 scripts/verify-astra-update.py path/to/astra-thing-update-dev.swu
```

The ZIP check streams member CRCs/hashes, verifies both GPT copies, bounds/partition geometry and exact flash steps. The SWU check verifies CPIO structure/checksums, payload hashes, expected sizes and the exact reviewed A/B write/select actions. Neither check proves bootability by itself.

Before updating a configured device, also inspect the actual boot-vfat logo and squashfs splash/app, verify the clean image has no credentials, and smoke-test the included ARM Python modules. The first Astra build passed those checks, including native OpenSSL key generation in the extracted root image. Its signed bootloader payload remained identical to the previously installed BSP.

## Update and rollback

A configured device should receive the `.swu` inactive-slot update, not the first-install ZIP, which replaces the complete layout. Back up both original logos, the OS splash, boot environment, pairing and preferences first. Check the running slot, bootloader-selected slot, target partition sizes and that the target is unmounted. Verify the transferred package hash and run SWUpdate's image check before applying it.

The development image currently includes the `swupdate` command and daemon but not `swupdate-client`. Stop the update socket/daemon for a one-shot checked installation; pass the explicit inactive selection (`stable,slot_b` when running slot A). After it succeeds, hash the written boot partition and the exact system payload length, confirm the next-boot slot, and restart the update service. A normal power cycle then tests the new system. Keep the previous slot available until startup, controls, pairing and branding have been checked.

For this device, the pre-branding system is slot A. The private pre-update backup is `.local/branding-backup/astra-before-branded-image.tar.gz` and also `/var/lib/astra-thing/before-branded-image` on the device. The latter includes the previous boot environment and original assets. The app-only rollback immediately before branding is `/opt/superbird-kiosk/astra/app.previous-20260912T054036Z`.

Changing the hostname to `astra-thing.local` does not change the device's SSH keys, which persist under `/var/lib/ssh`. Host tooling should retain the already-verified host identity when updating its locator.

## Earlier development build

The 2026-09-12 build (`0.2.0+20260912091540`) was installed into slot B and its boot/system partitions matched the verified payloads on readback. A physical unplug/reconnect booted `root_b` as Astra Thing 0.2.0; the owner confirmed the upright icon + wordmark and working Playing screen, theme and controls. Weston, Chromium, the companion daemon and SWUpdate were active, with zero automatic restarts for Chromium and the companion. Saved preferences matched the pre-update backup, and private state files retained mode 0600. Slot A remains the previous system.

The retained packages and verification/source-hash reports are in `.local/firmware/astra-thing-20260912091540/`; the device checkpoint is `.local/branding-checkpoint.json`.

This records the earlier development image. Its slot assignments are historical; later updates alternate slots. No image has been published.

The bootloader's [custom splash implementation](https://github.com/ThingLabsOSS/superbird-uboot/blob/89aaad01944b8f9c3962b6a5695b453e5d5e1bb7/board/amlogic/spotify-carthing/spotify-carthing.c) loads the active slot's `/logo.bmp` before falling back to the other slot or its built-in logo. Normal Astra boots therefore use the per-image branding without reflashing the bootloader.

## Production profile, version 0.3.0

### Manual standard-runner experiment

**Actions → Firmware on standard runner (manual experiment) → Run workflow**
tries the production build on `ubuntu-24.04`. It has only `workflow_dispatch`;
pushes, pull requests and releases do not trigger it. One experiment runs at a
time. It starts with a fresh BSP checkout at the pinned revision, uses the pinned
kas container and upstream public sstate mirrors, and limits compilation to four
jobs. Unused SDKs are removed only from the disposable hosted runner; `rm_work`
also reclaims completed kernel/Chromium work directories.

The build step is bounded to 335 minutes inside a 350-minute job, leaving time
for setup and diagnostics within [GitHub's six-hour job limit](https://docs.github.com/en/actions/reference/limits).
Every minute the console reports CPU utilization, load, available RAM, swap,
free disk, the latest Chromium Ninja step count and the age of its last log
output. Step counts are work items, not a percentage of elapsed build time;
long compilations and linking can take time without producing new output.

Resource samples are saved every 30 seconds in `resources.jsonl`; console
updates are also saved in `progress.log`. Bounded compiler/cooker log tails,
the last Chromium progress and process snapshots are saved during the build.
A separate `always()` step collects a summary after failure or timeout, without
depending on the interrupted build's cleanup. Diagnostics are retained for
seven days. These are logs, not a resumable compilation cache: a retry still
starts with a fresh build tree and the upstream sstate mirrors. A successful run
also audits both initial slots, the update root and all boot/splash logos, then
uploads unsigned ZIP/SWU artifacts, build records and project sources. It does
not sign, create a release or contact a Thing. Hardware testing is still needed.

`--ci` is an optional resource profile for `scripts/build-astra-image.py --release`;
normal local builds keep their existing settings. The build record stores the
generated configuration hash and whether that profile was selected.

### Local production build

```sh
npm run build:firmware
```

This selects `config/astra-release.yml` and builds `astra-thing-image` plus `astra-thing-update`. Use their FlashThing ZIP and SWU, not the similarly named development outputs. `.local/release-build.json` records the fixed build identity, pinned BSP and hashes of the staged firmware inputs.

These npm commands wrap `scripts/build-astra-image.py`; they require Python, Docker/kas and the pinned BSP checkout described above. They do not bootstrap that environment or flash the Thing. On Windows, use WSL2/Linux with the Linux tools and checkout inside WSL; the native Windows command reports this requirement before starting a build. The manager installer has its own native Windows/macOS build commands and does not require a firmware rebuild.

Production runs its packaged client directly from the immutable system image. It preserves music pairing and preferences under `/var/lib/astra-thing` while ignoring old development app overlays. It includes `superbird-weston-init-kiosk`, which supplies the actual Weston configuration and panel orientation. SSH/ADB/VNC/CDP and unsigned SWUpdate ingress are disabled; the authenticated management service owns updates.

Audit the extracted image with `scripts/audit-release-rootfs.py ROOTFS BUILD_RECORD`, then verify both signed artifacts. Extract squashfs inside a Linux filesystem rather than onto a case-insensitive macOS bind mount. Smoke-test the ARM Python runtime inside the extracted image. See [release assembly](../release/README.md) for signing.

Continuous app/input heartbeat is required before marking a boot good. Failed startup triggers a reboot; bootloader slot retries restore the previous system. A failed-display candidate physically exercised rollback on 2026-09-12. The corrected image reached Playing; the owner confirmed preserved pairing, theme and controls and approved the manager's matching code. A subsequent update through the real manager completed and reconnected with saved management access.

Use the manager's normal update path for production. `scripts/migrate-development-firmware.py` is a developer-only bootstrap for older images without maintenance support, not an end-user installation shortcut. A first-install ZIP replaces the layout and must not be used as an in-place update.
