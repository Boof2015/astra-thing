# Stock preservation: preparation and checkpoints

## Current status

Stock capture completed September 11, 2026 (local time). **A verified local stock
backup exists.** All 16 vendor-format partition captures were read twice with
matching SHA-256 hashes: 3,722,444,800 bytes per pass. A separate raw capture of the
first 4 MiB of the eMMC user area also matched on both reads; its payload at byte
512 matches the vendor-format bootloader dump.

The stock environment CRC is valid over its 64 KiB payload. The four filesystem
images have valid ext-family headers and fit inside their captured partitions.
These are header checks, not a full filesystem consistency check.

ROM recovery entry and RAM-loading the bundled vendor recovery both worked.
During stock capture, no flash, erase, unlock, or saved-environment commands were
issued. No stock restore has been performed. A direct read of `reserved` returned
`failed`; no unprotect or other protection-setting command was attempted during
capture. The later development-image installation is recorded separately in
[the bring-up notes](bringup.md).

The private working folder is `backups/stock-20260912T023549Z/`; its sibling
`.tar.gz` archive contains the first-read images, decoded environment, logs,
verification reports, pinned tool source, and exact capture scripts. The second
read remains separately on the Mac. The archive has an adjacent `.sha256` file.

The owner has confirmed making a second copy. Its destination and a checksum run
on that copy were not reported. The owner accepts the documented capture gaps as
limitations of the fallback backup; obtaining a complete physical chip image is
not a prerequisite for continuing with the standard firmware workflow.

- Host: Apple Silicon, macOS 26.5.1, Python 3.14.6.
- Existing Homebrew dependency: libusb 1.0.30.
- Isolated Python environment: `.local/venv`.
- Unmodified toolkit: `.local/superbird-tool`, upstream commit
  `da05fb49f7ebb2d0aebff128d3e197fd087d1709`.
- PyUSB commit: `3241c0e6a7debafd7597925e8403d9d3ea02ed93`.
- pyamlboot commit: `d2857f4371bcdb7a90d885f24987e03b6d647a8a`.
- Installed setuptools: 84.0.0.
- Verified: libusb backend loads; pyamlboot exposes `bulkCmd`; toolkit detection
  works with host USB access outside the execution sandbox.

`.local/` and `backups/` are ignored by Git. Keep device dumps, environment
contents, serials, and private logs there; do not publish them in this repo.

## First firmware change checkpoint

1. ROM recovery was reconfirmed before the first flash and again after the new
   OS booted, using the sequence below.
2. The selected kiosk development image's flash metadata, boot hardware writes,
   and GPT changes were reviewed before installation. Image verification and
   hardware observations are in the bring-up notes. A complete return-to-stock
   restore has not been tested on this device.

The second copy can be checked in its destination directory with
`shasum -a 256 -c stock-20260912T023549Z.tar.gz.sha256`. Preserve the original
archive and checksum; later checkpoint updates belong outside that archive.

## ROM recovery sequence

Use a USB cable that carries data, connected to this Mac. Starting unplugged,
hold preset buttons **1 and 4**, connect USB, then release after the host detects
the device. The display should stay black. This should enumerate as
`1b8e:c003`, product `GX-CHIP`.

From the repository root, run only detection first:

```sh
.local/venv/bin/python .local/superbird-tool/superbird_tool.py --find_device
```

A black screen alone does not establish recovery access. Confirm the USB ID and
tool-reported mode. If detection fails, investigate cable, port, or host USB
permissions before changing the device. macOS normally needs no root for this
tool; an execution sandbox may still require separate host USB access.

## Capture procedure

For any new capture, use a new directory and preserve this original archive.

1. Confirm exactly one intended Amlogic device is connected. Record host/tool
   versions and device USB mode in a fresh, private, timestamped backup directory.
2. Use the toolkit's plain `--burn_mode` command, with no custom image argument,
   to RAM-load its bundled vendor BL2/U-Boot. Inspect the result and confirm
   `--find_device` reports USB Burn Mode. The inspected host code uses RAM uploads
   and execution for this transition; it does not issue a flash/write command.
3. Read `bootloader` and `env` first into new files using `--dump_partition`.
   Preserve raw `env.dump` and derive `env.txt` locally with `--convert_env_dump`,
   avoiding the extra environment initialization done by `--get_env`.
4. Query actual sizes using `amlmmc size <name> 0x13000000`, then read the unsigned
   little-endian 64-bit sector count from that RAM address and multiply by 512.
   This command was verified against Spotify's published `do_amlmmc_size` source.
   It resolved this unit's geometry without relying on the tool's last-sector
   probe. The bootloader query reports a 4 MiB raw partition; the vendor dump
   format captures its 2 MiB restore payload. For all other captures use the
   queried sizes directly.
   Capture all 16 named partitions supported by the stock dump operation:
   bootloader, env, fip_a, fip_b, logo, dtbo_a, dtbo_b, vbmeta_a, vbmeta_b,
   boot_a, boot_b, misc, system_a, system_b, data, settings. Use upstream's
   filenames: `system_a.ext2`, `system_b.ext2`, `data.ext4`, `settings.ext4`,
   and `<partition>.dump` for the rest.
5. Validate file sizes and contents, check environment CRC over 64 KiB, and
   generate a SHA-256 manifest. Re-read partitions into separate paths and compare
   hashes while the stock OS is not running. A hash alone establishes neither
   completeness nor a correct read. Never overwrite the first capture.
6. Copy the archive and manifest to an owner-selected independent storage
   destination and verify the copied files. Another folder on this Mac's internal
   disk is not the independent copy.
7. Confirm repeatable ROM recovery entry and document the applicable restore
   path and its coverage before flashing. Recovery detection is not a tested
   restore; do not reflash the untouched device merely to test a backup.

## Findings that affect backup and restore

These are findings in the pinned toolkit source, not observations of this unit.

- `--dump_device` recursively removes its destination before creating it. Prefer
  separate partition captures in a fresh directory. Never point it at an existing
  backup or the repository root.
- The named-partition dump omits `reserved` and the zero-length `cache` entry.
  The attempted direct reserved read also failed on this unit. eMMC boot0/boot1,
  RPMB, and all raw disk gaps are not separately captured. The supplemental raw
  bootloader capture preserves its full user-area partition and first-sector
  header, but the backup is not a complete physical eMMC image.
- The size table has two `data` sizes. `validate_partition_size()` probes the last
  sector, but `bulkcmd()` suppresses errors for commands containing `amlmmc`.
  Therefore its printed validation success and alternate-size fallback cannot be
  trusted on their own. The capture wrapper instead uses the device's size query
  and strictly checks command responses. The published named-read implementation
  also lacks a partition-end bounds check, so a successful last-sector read alone
  would not be sufficient to establish partition size.
- Environment conversion computes a CRC result but ignores it. On this unit the
  CRC covers 64 KiB, not the full 8 MiB environment partition; that payload CRC
  was independently verified. The raw 8 MiB dump is preserved.
- `--restore_device` imports/saves environment data, writes named partitions, and
  writes the bootloader last. It does not reconstruct arbitrary raw storage or a
  new partition layout, and it catches bootloader restore errors. Its completion
  message alone is not sufficient evidence of successful recovery.
- Current yocto-superbird replaces the stock layout with GPT and mainline U-Boot.
  Returning from that layout needs an explicitly reviewed migration/recovery path;
  do not assume a named stock-partition restore will discover the old layout.

Do not run `fastboot flashing unlock`; the original researchers reported bricking
every unit on which they tried it. No persistent environment, AVB, bootloader,
partition table, charger-check, or UART changes belong in this backup phase.

## Sources

- [Tool README and macOS/recovery instructions](https://github.com/ThingLabsOSS/superbird-tool/blob/da05fb49f7ebb2d0aebff128d3e197fd087d1709/Readme.md)
- [Dump/restore handlers](https://github.com/ThingLabsOSS/superbird-tool/blob/da05fb49f7ebb2d0aebff128d3e197fd087d1709/superbird_tool.py)
- [Device operations and size checks](https://github.com/ThingLabsOSS/superbird-tool/blob/da05fb49f7ebb2d0aebff128d3e197fd087d1709/superbird_device.py)
- [Stock partition table](https://github.com/ThingLabsOSS/superbird-tool/blob/da05fb49f7ebb2d0aebff128d3e197fd087d1709/superbird_partitions.py)
- [Environment parser](https://github.com/ThingLabsOSS/superbird-tool/blob/da05fb49f7ebb2d0aebff128d3e197fd087d1709/uboot_env.py)
- [Spotify vendor storage size/read command implementations](https://github.com/spsgsb/uboot/blob/buildroot-openlinux-201904-g12a/common/cmd_aml_mmc.c)
- [Original recovery research and fastboot warning](https://github.com/frederic/superbird-bulkcmd#known-dangerous-actions)
- [Yocto layout and flashing overview](https://github.com/JoeyEamigh/yocto-superbird)
