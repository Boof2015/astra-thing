# Astra Thing Manager

A standalone guided installer and maintenance app for Astra Thing. It does not install, replace, or run the Astra music app.

This is a **development preview**. The manager uses real USB and file operations. The separate `design-preview/manager.html` is the offline visual simulation.

## Develop

Requires Node.js 24+, Rust and the native C build tools on the development host. End users will use a packaged application.

- macOS: Xcode Command Line Tools (`xcode-select --install`) and Rust.
- Windows: Visual Studio Build Tools with **Desktop development with C++**, a Windows SDK, and Rust's MSVC toolchain. Restart the terminal after installing tools.
- Linux: Rust and the distribution's C/C++ build tools.

The simplest workflow is from the repository root: `npm install`, then `npm run dev`. Root installation installs both this package and the pinned branding tool. Alternatively, from `manager/`:

```sh
npm ci
npm run dev
```

`npm run preview` opens the same interface with sample data for every screen and no device, worker or network access. Jump between screens from the Screens menu, or step with Cmd/Ctrl+] and Cmd/Ctrl+[. Buttons move to the screen that would normally follow, and the Platform menu switches platform-specific help.

`npm run dev` builds the worker incrementally before launch. The worker bundles libusb. It accepts a bounded JSON request and emits JSON progress; USB targets use their bus and physical port path.

```sh
npm test
cargo test --locked --manifest-path native/Cargo.toml
npm run build
```

The macOS build produces a DMG, Windows an NSIS installer, and Linux an AppImage and Debian package in `manager/dist/`. `build:mac`, `build:windows` and `build:linux` select explicitly; `dist` remains an alias for the host build. These commands work from the root too. Build on each target OS/architecture: cross-OS packaging is rejected to prevent bundling a worker for the wrong system, and Electron and the Rust worker use the current Node architecture. Use a native x64 Node/Rust environment for Intel/x64 packages and arm64 for Apple silicon/ARM packages.

Public installers still require platform signing and hardware validation. macOS previews are ad-hoc signed by default; public builds must override `mac.identity` in the build configuration with the publisher's Developer ID identity and configure notarization. The build assigns an app-specific launcher UUID before signing so macOS does not confuse it with stock Electron. No build command publishes or installs the app on your computer.

## Firmware

Choose `release.json` from a signed release folder. Keep its ZIP and SWU beside it. The signature pins the model, version, build, artifact sizes and hashes. The first-install worker also validates the ZIP contents, GPT checksums/geometry and permitted write operations. The Thing independently verifies the signature and exact A/B update description before invoking SWUpdate.

Check for firmware reads the latest stable GitHub release from `Boof2015/astra-thing`, verifies its signed manifest, and downloads only the matching artifacts. Until a stable release is published, choose a signed local release for testing. Downloads never grant permission to install.

## Management access

USB discovery is untrusted until pairing. The manager and Thing derive a six-digit code using ephemeral P-256 keys, with the HTTPS certificate included in the transcript. Approve on the Thing after comparing both screens. Requests carrying a credential only begin after certificate pin verification. Discovery does not grant access. Discovery uses mDNS plus the device address of an attached `10.42.1.x/29` USB link, including cables connected after the manager starts. It does not scan the LAN.

The manager stores access in OS-encrypted storage where available; otherwise it uses a private file in the app’s user-data directory. The renderer never receives credentials. Forget managers in the Thing’s Device settings to revoke all manager access. Music pairing remains separate.

On Windows, discovery binds a separate mDNS browser to each attached Thing USB interface so Wi-Fi, VPN and virtual adapters cannot redirect its queries to the default adapter. Interface changes and failed browsers are reconciled every five seconds. This adapts Astra's Windows discovery fix (`0c32125`) for the manager's browsing role; the direct USB-address fallback remains available. See [Windows test steps](../docs/manager-platforms.md#windows).

## Current limits

- First-install backup supports the original stock partition layout. Reformatting an already-modified device is not offered as a stock restore.
- Readable stock partitions are not a complete clone of protected chip data. Return-to-stock restoration has not been validated.
- An interrupted installation is never reported as complete. Completion requires the expected running firmware and device approval. Updates also require the expected operation and boot-health confirmation.
- Windows USB driver setup and Linux permissions need validation on physical hosts; see [platform setup](../docs/manager-platforms.md).
- The development firmware used before version 0.3.0 has no management service. It needs a developer-assisted A/B migration before this manager can update it.

GPL-3.0-only. The vendored FlashThing code and other dependencies retain their own licenses; see [third-party notices](../LICENSES/THIRD-PARTY.md).
