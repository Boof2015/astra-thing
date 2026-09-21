# Manager platform setup and validation

These are development requirements and candidate end-user instructions. They must be exercised on clean hosts before a public release is called supported.

## macOS

Use a USB data cable and allow the accessory when macOS asks. Allow Thing Manager local-network access as well: normal USB management uses a network interface. If it was denied, enable Astra Thing Manager in System Settings → Privacy & Security → Local Network. The package declares its purpose and Bonjour service in Info.plist, following [Apple’s local-network guidance](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy). Recovery uses bundled libusb; normal management uses the Thing’s USB network connection. The native worker links only to macOS system libraries/frameworks. Both Apple silicon and Intel packages are configured; the local build has been produced on Apple silicon.

Preview DMGs use a local ad-hoc signature. The public macOS package needs Developer ID signing and notarization. The packaging hook gives the main launcher an app/source-specific build UUID before signing, avoiding the stock Electron UUID shared by unrelated apps. It preserves the executable instructions and updates only LC_UUID. This follows Apple’s build-identity guidance linked above.

## Windows

The recovery device has USB ID `1b8e:c003` (Amlogic/GX-CHIP). The worker needs WinUSB access to that recovery interface. A guided, device-specific driver installation remains to be integrated and tested. Do not replace the network driver on a running Thing or select unrelated USB devices.

Normal firmware uses CDC-NCM USB networking. Validate discovery and reconnection on the supported Windows versions before advertising compatibility. No driver downloader or automatic administrator command is currently included.

Manager discovery includes the browser-side adaptation of Astra commit `0c32125`: each attached `10.42.1.x/29` USB interface gets its own mDNS socket, bound to `0.0.0.0:5353` with the outbound interface set explicitly. Every five seconds the manager checks for attachment, removal and address changes, repeats queries, and retries failed adapters independently. It also probes the device address of attached USB subnets directly; it does not scan Wi-Fi or VPN networks. Discovery failures are logged with `[thing-discovery]`.

For the Windows flasher test, build the manager from the updated sources. Test with Wi-Fi and any usual VPN/virtual adapters enabled: start with the Thing disconnected, plug it in, then unplug/reconnect and check discovery again after firmware startup. Also test launching the manager with the Thing already connected. Recovery-mode USB detection and WinUSB requirements are separate from this network-discovery fix. The firmware itself does not need rebuilding for this manager change.

## Linux

The candidate rule below grants a locally active desktop user access to the recovery interface. Administrators can install it as `/etc/udev/rules.d/70-astra-thing.rules`, reload udev rules, then reconnect the Thing. Do not run the whole manager as root.

```udev
SUBSYSTEM=="usb", ATTR{idVendor}=="1b8e", ATTR{idProduct}=="c003", TAG+="uaccess"
```

Validate the rule on a clean distribution, including systems without a desktop session’s `uaccess` integration. Normal networking also requires the host to configure the Thing’s CDC-NCM interface by DHCP. Discovery uses mDNS plus the device address of an attached USB subnet.

## Required host checks

For each OS: no development tools installed; stock/recovery detection; clear permissions/driver recovery; two-read backup; matching release signature; first installation; startup confirmation; manager approval and revocation; inactive-slot update; unplug/reconnect; interrupted transfer; and failed-new-slot recovery.

Packaging success alone does not establish device compatibility.
