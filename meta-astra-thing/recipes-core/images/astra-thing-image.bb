SUMMARY = "Astra Thing release firmware"
LICENSE = "MIT"
SUPERBIRD_ROOTFS_TYPE = "squashfs-lz4"
require recipes-core/images/superbird-kiosk-image-base.inc
IMAGE_FEATURES:remove = "ssh-server-openssh tools-debug debug-tweaks empty-root-password allow-empty-password allow-root-login serial-autologin-root"
IMAGE_INSTALL:append = " astra-thing-app astra-thing-management superbird-weston-init-kiosk"

astra_release_defaults() {
    install -d ${IMAGE_ROOTFS}${sysconfdir}/systemd/system
    for unit in sshd.service sshd.socket ssh.service android-tools-adbd.service kiosk-cdp-proxy.service swupdate.service swupdate.socket superbird-slot-ok.timer; do
        ln -sf /dev/null ${IMAGE_ROOTFS}${sysconfdir}/systemd/system/$unit
    done
    rm -f ${IMAGE_ROOTFS}${sysconfdir}/usb-debugging-enabled
}
ROOTFS_POSTPROCESS_COMMAND += "astra_release_defaults; "
