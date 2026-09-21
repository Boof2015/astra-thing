SUMMARY = "Astra Thing hardware companion"
DESCRIPTION = "The live 800x480 Astra client, pairing, playlists, queue, search and device settings. Contains no device credentials."
LICENSE = "GPL-3.0-only"
LIC_FILES_CHKSUM = "file://${UNPACKDIR}/LICENSE;md5=1ebbd3e34237af26da5dc08a4e440464"
PV = "0.3.0"

FILESEXTRAPATHS:prepend := "${ASTRA_THING_ROOT}:"
SRC_URI = "file://prototype file://LICENSE"
S = "${UNPACKDIR}/prototype"
inherit allarch

RDEPENDS:${PN} = " \
    python3-core python3-netserver python3-netclient python3-json python3-crypt \
    python3-threading python3-html python3-logging python3-ctypes python3-misc python3-shell \
    openssl-bin avahi-utils \
"

do_configure[noexec] = "1"
do_compile[noexec] = "1"
do_install() {
    install -d ${D}${nonarch_libdir}/superbird-kiosk/astra/app
    cp -R --no-preserve=ownership ${S}/. ${D}${nonarch_libdir}/superbird-kiosk/astra/app/
    find ${D}${nonarch_libdir}/superbird-kiosk/astra/app -type d -exec chmod 0755 {} +
    find ${D}${nonarch_libdir}/superbird-kiosk/astra/app -type f -exec chmod 0644 {} +
    chmod 0755 ${D}${nonarch_libdir}/superbird-kiosk/astra/app/launch
}
FILES:${PN} = "${nonarch_libdir}/superbird-kiosk/astra/app"
