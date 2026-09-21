# On-device Astra Thing

Astra Thing runs on the [Astra development image](image-build.md) and connects directly to Astra's HTTPS Companion API v2 over USB. The Mac runs Astra; there is no separate bridge process to keep running on the Mac. The client can also be deployed onto the pinned upstream kiosk development image.

## Live interface

The approved 800×480 interface now includes Playing, playlists, Queue, touch Search, setup/pairing, reconnect, Settings, and the app startup wordmark. The original local preview remains the design reference.

- Playing retains the 236 px artwork, large title/artist, anchored transport and seek rail, and immediate volume overlay. Previous/Next have inverse pressed feedback; pending commands do not dim or replace the transport row.
- Presets 1–4 open Playing, Playlists, Queue, and Search. Settings opens the full settings menu. Back returns through the current flow.
- The dial changes volume on Playing, selects items elsewhere, and reorders the selected entry in Queue's move mode. Press selects or confirms. Physical events have one active UI owner; stale events are not replayed after reconnect.
- Playlists load three cards at a time using signed continuation cursors. Selecting a card plays the playlist in Astra.
- Queue shows large vertical rows and a stable current selection. A track's actions are Play next, Move, and Remove. Moves are identified by the unique queue entry, so repeated songs remain distinct. A short DOM window keeps large queues from rendering thousands of rows.
- Search uses the Thing's touch keyboard and up to 50 track results. A result offers Play now, Play next, and Add to queue. The search field is read-only to the OS input method; our keyboard updates its value and selection. This suppresses the duplicate Weston keyboard, which ignored `inputmode="none"`.
- Artwork is fetched through a bounded native cache; only visible browsing thumbnails are requested. The background hue is sampled once per cover and constrained to the approved surface/ink roles. Unsuitable covers use neutral surfaces.

## Pairing and settings

With Astra open and companion connections enabled, use **Find Astra** during setup or **Settings → Connection → Pair with Astra again**. Compare the six-digit code on both screens, then approve in Astra. Re-pairing preserves appearance settings. There is no need to factory-reset for new permissions.

Discovery identifies a candidate, but does not establish trust. The backend inspects the actual TLS certificate, derives its own pairing code with P-256 ECDH/HKDF/HMAC, and decrypts credentials with OpenSSL AES-GCM only after approval and possession proof. The transcript binds the hardware profile, identity, labels and requested scopes. The web UI never receives the credential or private key. The approved certificate pin is checked before sending each authenticated HTTP request. Rediscovery may update the remembered USB address, but never replaces its certificate pin.

Hardware receives `observe`, `playback-control`, and `library-search`, plus the legacy session-management `control` scope. It receives no library-write permission or sync token. Full protocol: Astra's `docs/api/hardware-pairing.md`.

Settings include Connection/pair/forget, light/dark Appearance and Album color, native Brightness (25–100%), idle dimming (Off/30 seconds/2 minutes), Device restart and two-stage factory reset, and Info with the pixel heart credit for Boof2015. The first tap or dial gesture wakes a dimmed display without also changing music. Reset clears this Thing's pairing/preferences and returns to setup; it does not change Astra's music or the installed firmware.

## Implementation and storage

- `prototype/client.py`: pinned HTTPS transport, local HTTP server, playback controls and raw input reader.
- `prototype/hardware_pairing.py`: Avahi discovery and hardware-v1 pairing using the image's OpenSSL 3 library/CLI.
- `prototype/device_client.py`: remembered connections, event observation, playlist/search/queue requests, artwork cache, preferences and native display controls.
- `prototype/web/`: the approved interface adapted to live data, using plain HTML/CSS/JavaScript and the device's Liberation Sans/Arial metrics.

```text
/opt/superbird-kiosk/astra/app/          device source and web assets
/opt/superbird-kiosk/astra/runtime/      matching Yocto Python modules
/var/lib/astra-thing/connection.json    pinned identity and credential (0600)
/var/lib/astra-thing/preferences.json   appearance/display settings (0600)
/opt/superbird-kiosk/daemon/kioskd.stock preserved example daemon
```

The UI server binds only to `127.0.0.1:8080`, checks Host/Origin, permits a fixed set of routes, and requires JSON for mutations. Offline commands are rejected rather than saved for later replay. Token rotation and event reconnection run in the backend.

## Deployment and rollback

For an already installed prototype:

```sh
sh scripts/deploy-player.sh
```

The script packages 20 matching Python packages from the pinned local Yocto feed (about 3.9 MB for the complete compressed bundle), stages app/runtime directories, checks imports and native key generation, activates them, and polls the local health endpoint. A failed activation restores both previous directories. Previous directories remain on the device for manual rollback. Credential/preferences, kiosk environment and firmware are retained. Package hashes are in `.local/prototype-bundle/runtime-packages.json`.

The working Playing/Appearance app before this integration is retained at `/opt/superbird-kiosk/astra/app.previous-20260912T050915Z`, with the corresponding `runtime.previous-20260912T050915Z`. Earlier app checkpoints also remain. Stock flash backup/recovery is documented separately in `stock-backup.md` and `bringup.md`.

## Validation

Thirteen Python tests cover certificate pin enforcement before sending HTTP/credentials, input ownership and event replay, playback validation, independent Node/OpenSSL pairing interoperability and ciphertext tampering, discovery filtering, queue entry identity and neighboring positions, scoped browsing, private persistence, reset and dim/wake behavior. Run with local socket access:

```sh
python3 -m unittest discover -s tests -v
node --check prototype/web/app.js
node --check prototype/web/browse.js
node --check prototype/web/system.js
```

Real-device checks confirmed 800×480 sizing, live artwork, the new three-scope hardware pairing, playlist loading, and queue rows without browser errors. The owner confirmed matching-code pairing, playlist playback, touch search, enqueue, queue moving/removal, and the duplicate-keyboard fix. The installed desktop build and a subsequent Thing app/runtime update reconnected with the saved pairing. Further checkpoints and source hashes are recorded in `.local/full-integration-checkpoint.json`. The newest pre-update app/runtime directories are suffixed `20260912T052121Z`.

## Remaining boundaries

The development image retains SSH and Chromium debugging access. The supplied Astra icon + wordmark is included in the boot bitmap, Weston splash and app startup screen; see [image build and rollback](image-build.md). Main Astra's integration UI is functional and deliberately awaits its separate design/polish pass. Factory reset resets the Thing app, not the firmware.

The final physical unplug/reconnect check returned Playing automatically with the saved dark theme and working controls. Both device services were active with zero automatic restarts; connection and preference files remained mode 0600. Temporary debugging connections were closed, and the installed Astra app was reopened normally.
