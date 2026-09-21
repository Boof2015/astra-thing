SUMMARY = "Astra Thing release firmware A/B update"
require recipes-core/superbird-bsp-update/superbird-bsp-update.inc
SUPERBIRD_OTA_SOURCE_IMAGE = "astra-thing-image"
SUPERBIRD_OTA_SYSTEM_ARTIFACT = "${SUPERBIRD_OTA_SOURCE_LINKNAME}.squashfs-lz4"
SUPERBIRD_OTA_SYSTEM_CPIO_NAME = "system.img"
SWU_VERSION = "${DISTRO_VERSION}+${ASTRA_RELEASE_BUILD}"
FILESEXTRAPATHS:prepend := "${THISDIR}/files:"
