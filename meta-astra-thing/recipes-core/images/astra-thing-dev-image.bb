SUMMARY = "Astra Thing development image"
DESCRIPTION = "Astra-branded boot and OS splash with the hardware companion installed for first-time setup."
LICENSE = "MIT"
SUPERBIRD_ROOTFS_TYPE = "squashfs-lz4"
require recipes-core/images/superbird-kiosk-image-base.inc
IMAGE_FEATURES += "tools-debug post-install-logging"
IMAGE_INSTALL:append = " packagegroup-superbird-kiosk-dev astra-thing-app"
