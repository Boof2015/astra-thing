# Desktop integration checkpoint

The tested Astra desktop build is installed in `/Applications/Astra.app`. The matching source changes are in `../astra`, uncommitted. The Thing runs the complete live interface and has been re-paired using the hardware-v1 flow with playback, queue and library-search capabilities. Main Astra UI polish is deferred.

## Implemented in Astra

- **Settings → Integrations → Astra Thing & hardware**: enable the shared companion service, see remembered hardware and last-seen times, and forget a device.
- `hardware-v1` discovery advertisement on `_astra-remote._tcp` and code-comparison pairing with explicit desktop approval. Uses the existing HTTPS/P-256/HKDF/AES-GCM transport foundation, binding the hardware profile, labels, and requested scopes into the transcript.
- On macOS, discovery registers through the system DNS-SD service so USB and interfaces attached after launch are advertised. The earlier Node multicast default selected one outbound interface and missed the Thing. Other platforms retain Bonjour.
- No credentials before approval plus possession proof; no library sync or library-write scope. Legacy v1 playback/queue routes reject hardware credentials so they cannot bypass v2 permissions.
- `GET /v2/playlists` under `library-search`: default 12, maximum 50, signed continuation cursor, title/artwork/kind/count, total and next cursor. Database-bounded reads in stable creation order; dynamic counts are null rather than evaluating every dynamic playlist while browsing.
- Existing v2 playback, queue edits, track search, and play/enqueue intents support the rest of the agreed device capabilities.

Full protocol: `../astra/docs/api/hardware-pairing.md`. OpenAPI: `../astra/docs/api/openapi-v2.json`.

## Validation

51 focused tests passed: 22 phone/pairing/sync/discovery, 17 local API, 10 companion contract/refs/renderer bridge, 2 real SQLite companion tests. Typecheck and production build passed.

The compiled Electron app was also tested with an isolated profile at `/private/tmp/astra-hardware-preview` and test HTTPS port 38422. Independently derived codes matched the actual desktop dialog. Approval through the renderer completed encrypted pairing; authenticated capabilities and the empty playlist shelf worked. A full app restart preserved the hardware record; Forget removed it. Tab cycles between actions and Escape declines. The test app has been closed and the synthetic pairing was removed. The normal Astra profile and device credentials were not changed.

Screenshots are in `.local/astra-hardware-settings.png` and `.local/astra-hardware-pairing.png`. The tested desktop patch is retained at `.local/astra-desktop-hardware.patch`, with an isolated worktree at `.local/astra-desktop` on `feat/hardware-companions`; matching source changes have been applied to the normal Astra checkout, uncommitted.

## Real-device integration

The owner confirmed that the Thing finds Astra, both codes match, and approval reaches “You’re connected”. Real playlists and artwork/queue metadata load; playlist playback works. The owner also confirmed song search, enqueue, queue move/removal, and the duplicate OS keyboard fix. The Thing retained its dark appearance throughout updates.

The installed package passed code-signature verification and native DSP/waveform/SQLite load checks. A desktop app restart and Thing app/runtime update reconnected automatically with the saved hardware pairing. The previous installed app is retained at `.local/app-backups/Astra-installed-before-hardware-20260912.app`; a private library/settings backup is in `.local/before-full-device-client`.

The live Thing implementation is documented in `prototype.md`; deployment/source hashes and final checks are recorded in `.local/full-integration-checkpoint.json`. That integration was deployed without a firmware reflash. The subsequent branded OS build is documented separately in [image-build.md](image-build.md). Main Astra's UI/UX redesign is a separate polish pass after this functional integration.

The final physical unplug/reconnect check returned Playing automatically with the saved dark theme and working controls. Both device services were active with zero automatic restarts; connection and preference files remained mode 0600. Temporary debugging connections were closed, and the installed Astra app was reopened normally.
