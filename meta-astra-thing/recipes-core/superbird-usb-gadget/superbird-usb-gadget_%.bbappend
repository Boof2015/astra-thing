RDEPENDS:${PN}:remove = "${@'android-tools-adbd' if d.getVar('ASTRA_RELEASE') == '1' else ''}"
python astra_usb_release_defaults() {
    if d.getVar('ASTRA_RELEASE') != '1':
        return
    from pathlib import Path
    root = Path(d.getVar('D'))
    target = root / d.getVar('libexecdir').lstrip('/') / 'superbird-usb-gadget'
    text = target.read_text()
    text = text.replace('mkdir -p "$CFG/functions/ffs.adb"\nmkdir -p "$FFS_MOUNT"\nmount -t functionfs adb "$FFS_MOUNT"\n', '')
    text = text.replace('ln -sf "$CFG/functions/ffs.adb"  "$CFG/configs/c.1/"\n', '')
    text = text.replace('echo "gadget composed for $UDC (UDC bind deferred to adbd)"', 'echo "$UDC" > "$CFG/UDC"\necho "Astra USB network bound to $UDC"')
    text = text.replace('echo "  FFS-ADB  mounted at $FFS_MOUNT"\n', '')
    if 'mkdir -p "$CFG/functions/ffs.adb"' in text or 'deferred to adbd' in text:
        bb.fatal('USB gadget release conversion failed')
    target.write_text(text)
    (root / d.getVar('sysconfdir').lstrip('/') / 'usb-debugging-enabled').unlink(missing_ok=True)
}

do_install[postfuncs] += " astra_usb_release_defaults"
