# The upstream full-flash WIC includes logo.bmp, but its OTA boot image does not.
# Include the same logo in both update formats, before generating delta data.
do_compile[depends] += " superbird-logo:do_deploy"

do_compile() {
    rm -f ${B}/boot.vfat
    dd if=/dev/zero of=${B}/boot.vfat bs=1024 count=${BOOT_IMG_KIB}
    mkfs.vfat -n BOOT ${B}/boot.vfat
    mmd -i ${B}/boot.vfat ::extlinux
    mcopy -i ${B}/boot.vfat ${DEPLOY_DIR_IMAGE}/Image ::extlinux/Image
    mcopy -i ${B}/boot.vfat ${DEPLOY_DIR_IMAGE}/meson-g12a-superbird.dtb ::extlinux/meson-g12a-superbird.dtb
    mcopy -i ${B}/boot.vfat ${DEPLOY_DIR_IMAGE}/extlinux.conf ::extlinux/extlinux.conf

    mcopy -i ${B}/boot.vfat ${DEPLOY_DIR_IMAGE}/logo.bmp ::logo.bmp

    rm -f ${B}/boot.vfat.zck ${B}/boot.vfat.zck.zckheader
    zck --output ${B}/boot.vfat.zck -u --chunk-hash-type sha256 ${B}/boot.vfat
    hdr_size=$(zck_read_header -v ${B}/boot.vfat.zck | grep 'Header size' | cut -d ':' -f 2 | tr -d '[:space:]')
    dd if=${B}/boot.vfat.zck of=${B}/boot.vfat.zck.zckheader count=1 bs=$hdr_size
}
