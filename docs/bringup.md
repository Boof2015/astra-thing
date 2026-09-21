# First development image

## Scope and status

Build the upstream `superbird-kiosk-dev-image`, boot it, and establish display,
touch, button, encoder, USB networking, SSH, and repeatable ROM recovery access.
Astra pairing and the custom interface follow this hardware checkpoint.

The stock backup is verified and the owner has made a second copy; see
[its coverage and recovery limitations](stock-backup.md). The build completed on
September 11, 2026 (local time): all 6,230 tasks succeeded, with 18 upstream warning
messages. The image is installed and boots into the example UI. Display, touch,
all buttons, both encoder directions, USB networking, and SSH have been observed
working. Post-install ROM recovery was detected successfully, and another normal
power cycle returned to the example UI with USB/SSH and display services working.
**Milestone 1 is complete.**

## Pinned inputs and local build

[The toolchain profile](../config/bringup-toolchain.json) records exact upstream
and flasher revisions and the kas container digest. The first build used kas 5.5
with that same image digest. The upstream kas configuration pins each Yocto layer;
meta-meson also receives the three patches listed in upstream `kas/base.yml`.

On this Apple Silicon Mac:

- Docker Desktop: 11 CPUs, 24 GiB memory, 4 GiB swap, 128 GiB disk limit.
- Dedicated build volume: `astra-thing-yocto`; build directory `/build/build`.
- Python environment: `.local/build-venv`, kas 5.5.
- Host dependencies: Docker, `just`, GNU coreutils; Rust for the local flasher.
- Upstream checkout: `.local/yocto-superbird`.
- Flasher checkout: `.local/flashthing-source`; executable
  `.local/flashthing/bin/flashthing-cli`.

From the repository root:

```sh
python3 scripts/build-kiosk-dev.py
```

The script checks the upstream revision and tracked changes, copies the small
bring-up configuration, builds only the development image, and mirrors deploy
artifacts to `.local/yocto-superbird/build/tmp/deploy/`. It does not access USB or
invoke the flasher. The build log for this initial run is `.local/kiosk-build.log`.

The first attempt stopped before compilation because kas skipped pinned checkout
on three fresh layer clones reported as dirty. After confirming clean worktrees,
the affected layers were checked out at their configured commits and kas reapplied
the meta-meson patches. The next attempt parsed all recipes successfully. If this
recurs, inspect the checkout state and pinned revisions; do not discard changes
or build from mismatched branch heads.

## Retained first-build artifact

The initial image and verification records are retained privately in
`.local/firmware/kiosk-dev-20260912030240/`, outside the deploy mirror that a later
build refreshes. The archive is
`superbird-kiosk-dev-image-superbird-20260912030240-flashthing.zip` (415,740,133 bytes).
Its SHA-256 is
`c7550a5517de54cdb179b0732ff5e9c9227e30a80bf51985b6f48d0789d428bd`.

`scripts/verify-kiosk-image.py <archive>` checked every ZIP member's CRC while
streaming SHA-256 hashes, primary/backup GPT CRCs and agreement, nonoverlapping
partition bounds, expected metadata and flash steps, sector alignment, payload
sizes, and the bandaid filesystem signature. The retained copy was hashed again
and matched. These are local integrity/geometry checks, not boot-signature or
device readback verification.

## What the first flash changes

The expected artifact is
`images/superbird/superbird-kiosk-dev-image-superbird-flashthing.zip` under the
deploy directory. This is a complete initial-install image, not an OTA or
environment-only archive.

The pinned image recipe generates metadata version 2 with these operations:

1. Enable the vendor recovery's raw eMMC access with `amlmmc key`.
2. Write signed `superbird-boot.bin` to both eMMC boot hardware partitions.
3. Erase/write the user-area span covered by `superbird.wic`, starting at LBA 0.
4. Write `bandaid.ext4` into its GPT partition.

The GPT layout contains `env`, `boot_a`, `root_a`, `boot_b`, `root_b`, and
`bandaid`. First boot creates the remaining data partition. This replaces the
stock boot chain and partition layout. It is the intended initial installation
workflow, and is covered by the owner's decision to proceed after stock capture.

Before running it, inspect the actual archive metadata, payload integrity, GPT
geometry, and image sizes. Reconfirm exactly one intended device in ROM recovery
using the sequence in the backup document. Retain the verified installation
archive and its SHA-256 alongside the tool revisions.

Flash using the pinned CLI's normal Amlogic path. Review its complete log: this
CLI logs some flash failures without returning a failing process exit status.
The package is version 0.6.0 but its `--version` string is hardcoded to 0.1.0;
the Git revision is the reliable identifier.

Set `RUST_LOG=flashthing_cli=info,flashthing=info` when invoking it to retain
progress/completion messages. This Codex session inherited `RUST_LOG=warn`, so the
initial flash log suppresses those messages; errors and warnings remain enabled.
Do not interrupt a flash to change its logging configuration.

## Boot and hardware checks

After successful flashing, unplug and reconnect normally to boot from eMMC.
Expected development behavior is a Weston desktop with VNC and SSH access over
USB CDC-NCM. The expected mDNS hostname is `superbird-kiosk.local`. USB DHCP uses
a per-device subnet; discover the actual interface/address rather than assuming
an address. SSH uses root with an empty password in this upstream dev image.

Record the OS/kernel/build identity, USB interface, mount layout, service errors,
and memory usage. Inspect the display locally and through a screenshot if useful.
Use `evtest` to observe real touches, each button, encoder rotation in both
directions, and encoder press. These checks require physical interaction.

Finally, unplug, re-enter ROM recovery with presets 1 + 4, confirm detection, and
reconnect normally to verify the installed OS still boots. Passing compilation
or the flash command alone does not complete the hardware checkpoint.

### First-boot observations

- Owner observed the ThingLabs boot screen followed by the kiosk example.
  A Chromium screenshot confirmed the example page at 800×480. The panel's raw
  mode is 480×800, rotated by the display configuration.
- Linux `7.0.2-superbird`, aarch64; Superbird Kiosk Example 0.1.0 (wrynose).
- USB device `Superbird Kiosk`, Mac interface `en8`; device `10.42.1.234/29`,
  Mac DHCP address `10.42.1.238`. SSH/mDNS work at `superbird-kiosk.local`.
- eMMC user area: 3,959,422,976 bytes. The six image partitions have the expected
  sizes; first boot created a 2,529,148,416-byte data partition mounted at `/var`.
- Both eMMC boot hardware partitions are 2,097,152 bytes. Complete readback hashes
  of `/dev/mmcblk0boot0` and `/dev/mmcblk0boot1` match `superbird-boot.bin`:
  `c088adf7263adb93ae422e563e73212cd6e67abcbecacda2cec3824f28749d31`.
- Weston, Chromium, the example daemon, USB networking, and mDNS are running;
  systemd reports no failed units. SSH uses socket-activated per-connection units.
- About 245 MiB memory was available at idle in the first check, with zram enabled.
- After the recovery test, a normal power cycle returned to the same OS with
  Weston, Chromium, USB networking, and mDNS active and no failed systemd units.
  The owner confirmed the example screen returned. The temporary screenshot
  tunnel and input recording sessions have ended.
- The kernel log contains GPU regulator, disabled HDMI, and early USB gadget
  startup messages. Display/USB function after startup; this is not a claim of
  an error-free kernel log or a complete GPU/performance qualification.

Observed physical input mappings:

| Control | Device | Event |
| --- | --- | --- |
| Presets 1–4 | `event0`, gpio-keys-polled | `KEY_1` through `KEY_4`, press/release |
| Button below dial | `event0` | `KEY_ESC`, press/release |
| Top settings button | `event0` | `KEY_M`, press/release |
| Dial press | `event0` | `KEY_ENTER`, press/release |
| Dial rotation | `event1`, rotary | `REL_HWHEEL`, both -1 and +1 observed |
| Touchscreen | `event2`, tlsc6x | touch/release and changing multitouch X/Y during drag |

Direction signs have not yet been correlated with clockwise/counterclockwise.
Weston logs `unknown libinput event 404` for the dial; raw evdev events work,
but mapping the dial to Astra/browser actions remains part of the Astra client.

Private logs and the screenshot are beside the retained firmware. The temporary
SSH configuration is `.local/car-thing-ssh.conf`, with a dedicated known-hosts
file. VNC listens on port 5900, but the simple no-auth capture client was rejected
by the offered security methods. The screenshot instead used Chromium's local
debugging port 9223 through an SSH tunnel; VNC client compatibility is unverified.

## If the image does not boot

Return to ROM recovery with presets 1 + 4 and confirm host detection. The ROM/RAM
recovery path already worked before installation. Diagnose the flash log and use
the retained verified image for a repeat installation when appropriate.

Do not use `fastboot flashing unlock`. A complete return to stock has not been
tested: the backup omits some protected/hardware areas, and restoring named stock
partitions alone does not undo the new boot hardware partitions and GPT layout.
The CLI's `--unbrick` payload is not a verified complete return-to-stock process.

## Upstream references

- [Kiosk example and development behavior](https://github.com/JoeyEamigh/yocto-superbird/tree/5969a5f1c63dfc4ab2f52191db6d0ebbc22a672d/examples/meta-superbird-kiosk-example)
- [Image archive generation](https://github.com/JoeyEamigh/yocto-superbird/blob/5969a5f1c63dfc4ab2f52191db6d0ebbc22a672d/meta-superbird/classes/mainline-flashthing.bbclass)
- [Pinned flashthing source](https://github.com/JoeyEamigh/flashthing/tree/80146130826532482d703d8f351fb2aede0bf54a)
