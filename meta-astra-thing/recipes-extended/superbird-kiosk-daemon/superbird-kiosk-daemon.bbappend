# Retain the established vendor/service paths so existing devices can update
# without moving their app overlay or pairing data.
FILESEXTRAPATHS:prepend := "${ASTRA_THING_ROOT}/prototype:"
SRC_URI:append = " file://launch"
RDEPENDS:${PN}:append = " astra-thing-app"
do_compile[noexec] = "1"
do_install() {
    install -d ${D}${OPT_OVERLAY_TARGET} ${D}${DAEMON_FLOOR_DIR} ${D}${systemd_system_unitdir}
    install -m 0755 ${UNPACKDIR}/launch ${D}${DAEMON_FLOOR_DIR}/kioskd.current
    install -m 0644 ${UNPACKDIR}/superbird-kiosk-daemon.service ${D}${systemd_system_unitdir}/superbird-kiosk-daemon.service
    if [ "${ASTRA_RELEASE}" = "1" ]; then
        sed -i 's|ExecStart=.*|ExecStart=/usr/lib/superbird-kiosk/astra/app/launch|' ${D}${systemd_system_unitdir}/superbird-kiosk-daemon.service
    fi
}
