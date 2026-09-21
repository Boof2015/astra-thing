# Astra Thing

A dedicated Astra music companion for Spotify Car Thing: playback, playlists, queue, search, physical controls and an interface designed for its 800 × 480 touchscreen.

The standalone **Astra Thing Manager** guides installation and maintenance. It has real USB detection, verified stock backups, signed firmware checks, physical approval for management access, and inactive-slot updates. Astra desktop support ships with Astra’s next release; this project does not replace the desktop app.

**Development preview — not a public release yet.** The macOS manager and production firmware are under device validation.

- [Run or build Thing Manager](manager/README.md)
- [Release plan and acceptance](docs/public-release-plan.md)
- [Platform setup](docs/manager-platforms.md)
- [Firmware builds](docs/image-build.md)
- [Signed releases](release/README.md)
- [Stock backup coverage](docs/stock-backup.md)
- [Hardware bring-up and recovery notes](docs/bringup.md)
- [Offline UI concepts](design-preview/README.md)

From this directory, with Node.js 24+, Rust, and the native C build tools installed:

```sh
npm install
npm run dev
```

`npm install` installs the pinned manager and branding dependencies. `npm ci` works too. Development automatically builds the USB worker incrementally, then opens the manager.

| Command | Result |
| --- | --- |
| `npm run dev` | Launch Thing Manager from source |
| `npm run build` | Build the manager installer for this machine |
| `npm run build:mac` | Build a macOS DMG on a Mac |
| `npm run build:windows` | Build a Windows NSIS installer on Windows (`build:win` also works) |
| `npm run build:linux` | Build Linux AppImage and Debian packages on Linux |
| `npm run build:worker` | Build only the native USB worker |
| `npm run build:branding` | Regenerate firmware boot artwork from the SVG |
| `npm run build:firmware` | Build production first-install and update firmware with the pinned Yocto environment |
| `npm run build:firmware:dev` | Build the development firmware profile |
| `npm test` | Run manager and UI model tests |
| `npm run test:worker` | Run native worker tests |
| `npm run test:firmware` | Run Python client and management tests |

Manager installers appear in `manager/dist/`. Builds use the current machine's OS and Node architecture for both Electron and the worker; build Windows on Windows and macOS on macOS. On Windows, install Visual Studio Build Tools with **Desktop development with C++**, a Windows SDK, and Rust's MSVC toolchain. On macOS, install Xcode Command Line Tools and Rust. See [manager development](manager/README.md) for details.

Firmware has separate Docker/kas/BSP prerequisites; see [firmware builds](docs/image-build.md). On Windows, run firmware builds inside WSL2/Linux, while building the Windows manager natively. Build commands do not flash hardware or publish releases. Full manager tests additionally use Python 3 and OpenSSL on PATH.

Publisher helpers accept explicit paths: `npm run release:sign -- PRIVATE_KEY FLASH_ZIP UPDATE_SWU BUILD_RECORD OUTPUT_DIRECTORY` and `npm run release:sources -- OUTPUT_ARCHIVE --build-record BUILD_RECORD`. See [signed releases](release/README.md).

The `.local/`, `backups/`, `work/`, dependency and build-output directories are excluded from Git, as are local environment files and signing keys. Public trust keys, lockfiles, icons, firmware branding inputs and required vendored boot resources are intentional source inputs and remain included.

Original client and manager code: GPL-3.0-only, matching Astra. Dependencies retain their licenses and attribution; see [third-party notices](LICENSES/THIRD-PARTY.md).
