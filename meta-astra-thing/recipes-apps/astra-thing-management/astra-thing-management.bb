SUMMARY = "Astra Thing USB maintenance and firmware health"
LICENSE = "GPL-3.0-only"
LIC_FILES_CHKSUM = "file://${UNPACKDIR}/LICENSE;md5=1ebbd3e34237af26da5dc08a4e440464"
FILESEXTRAPATHS:prepend := "${ASTRA_THING_ROOT}:"
SRC_URI = "file://LICENSE file://astra-thing-management.service file://astra-thing-mark-good file://astra-thing-boot-watchdog.service file://astra-thing-boot-watchdog.timer"
inherit allarch systemd
SYSTEMD_SERVICE:${PN} = "astra-thing-management.service astra-thing-boot-watchdog.timer"
SYSTEMD_AUTO_ENABLE = "enable"
RDEPENDS:${PN} = "astra-thing-app python3-io python3-compression python3-shell python3-fcntl util-linux-findmnt util-linux-blockdev libubootenv-bin swupdate"
do_install() {
    install -d ${D}${systemd_system_unitdir} ${D}${libexecdir} ${D}${sysconfdir}
    install -m 0644 ${UNPACKDIR}/astra-thing-management.service ${D}${systemd_system_unitdir}/
    install -m 0644 ${UNPACKDIR}/astra-thing-boot-watchdog.service ${D}${systemd_system_unitdir}/
    install -m 0644 ${UNPACKDIR}/astra-thing-boot-watchdog.timer ${D}${systemd_system_unitdir}/
    install -m 0755 ${UNPACKDIR}/astra-thing-mark-good ${D}${libexecdir}/
    printf '{"version":"%s","build":"%s","modelId":"astra-thing"}\n' '${DISTRO_VERSION}' '${ASTRA_RELEASE_BUILD}' > ${D}${sysconfdir}/astra-thing-release.json
}
FILES:${PN} = "${systemd_system_unitdir} ${libexecdir}/astra-thing-mark-good ${sysconfdir}/astra-thing-release.json"
