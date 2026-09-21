# Third-party components

Astra Thing's original client and manager code is GPL-3.0-only. That license does not replace the licenses of dependencies, firmware components, or supplied binary resources.

- **FlashThing**, Joey Eamigh and contributors, MIT. Vendored from revision `80146130826532482d703d8f351fb2aede0bf54a`. The complete vendored license and changes/provenance are in `manager/native/vendor/flashthing/LICENSE` and `UPSTREAM.json`. Resources include the upstream boot binaries; retain their provenance with release source materials.
- **car-thing-bootloader-tool**, MIT. The readable-partition AMLC transfer protocol was adapted from this toolkit. Its copyright and permission text are in `car-thing-bootloader-tool-MIT.txt`.
- **libusb**, LGPL-2.1-or-later, statically built by `libusb1-sys` for the manager worker. Publish the worker’s corresponding source and build instructions, including the pinned Cargo dependency sources, so users can rebuild it with a modified library.
- **Electron**, MIT, and **Chromium** and its dependencies, various licenses. Preserve Electron’s `LICENSE` and `LICENSES.chromium.html` in packaged applications.
- **bonjour-service**, MIT, with dependencies as recorded in `manager/package-lock.json`.
- **yocto-superbird** and its pinned OpenEmbedded/Yocto layers supply the Linux kernel, boot chain, Chromium kiosk, SWUpdate and system packages. The release build enables license manifests and SPDX output. Publish matching source/build material and required notices alongside firmware; the root project license alone does not describe the whole image.

Before public distribution, review the generated dependency/license manifests, include all required notices and source materials, and verify the redistribution terms attached to binary firmware resources. This development checkout has not yet been published as a binary release.
