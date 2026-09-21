python astra_chromium_release_defaults() {
    if d.getVar('ASTRA_RELEASE') != '1':
        return
    from pathlib import Path
    root = Path(d.getVar('D'))
    matches = list(root.rglob('chromium-kiosk-launch'))
    if len(matches) != 1:
        bb.fatal('Cannot locate the kiosk launch script')
    target = matches[0]
    text = target.read_text()
    text = '\n'.join(line for line in text.splitlines() if '--remote-debugging-port=' not in line and '--remote-allow-origins=' not in line) + '\n'
    target.write_text(text)
}

do_install[postfuncs] += " astra_chromium_release_defaults"
