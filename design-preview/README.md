# Local visual study

## Astra Thing Manager concept

Open `manager.html` for the standalone Windows/macOS/Linux installation and
management concept. It is separate from the on-device interface below.

The first-install flow covers connection, illustrated recovery entry, selecting a
backup destination, backup verification, explicit installation review, progress,
normal reconnect, and handoff to pairing in Astra. The device illustration marks
presets 1 and 4 while the instructions say to keep holding them. A simulated USB
recovery event advances the screen to “You can let go now”; a black screen alone
does not advance it.

The front illustration keeps the preset positions visible. A small close-up of
the back below it, traced from a photo of the device and mirrored as seen when
turned around, shows the USB-C port recessed in the side wall of the raised
center plate. The
cable lies flat along the back and slides in from the device's left side,
following the owner's hardware correction. The drawing is shared with the real
manager (`../manager/renderer/device-art.js`) and stays on screen between steps:
the view eases toward the port or the screen, hands-on steps loop a short
demonstration (unplug; hold presets 1 and 4, then plug in; plug in normally),
transfers show a soft light moving along the cable in the direction of the data,
and pairing shows the code on the Thing. Reduced-motion settings show still poses.

Controls outside the application frame simulate plugging/unplugging, recovery
detection, and successful firmware startup. The View selector jumps to the
recovery guide, returning-device manager, or an interrupted install. The manager
includes update review, progress, restart, and confirmation of the new version.
Backup/install/update progress takes about six seconds each in the foreground.
Disconnect USB during a simulated operation to explore error handling. An
interrupted backup cannot count as verified or unlock installation.

All state is in memory and resets on reload. Version names and backup locations
are illustrative. This page has no USB, network, filesystem, or firmware access;
it never launches Astra or changes the real device. The example is not a shipped
installer, a recovery implementation, or platform support validation.

Desktop and narrow-layout checks cover the complete install/update sequence,
interrupted backup, explicit reinstall review, local assets, and renderer errors.

## Current: Search, Queue, setup, and settings

Open `companion.html`. The owner considers the UI language and core interactions
settled. Queue extends the same filled selection and rounded action keys, alongside
Connection, Appearance, Display, Device, and Info. Playing and Playlists retain
the approved hierarchy and styling. Search is also accepted; this preview is the
approved reference for the first complete interface, pending API v2 integration
and checks on the physical device.

Preset 4 opens Search. Typing has its own screen with a large query field and
four-row touch keyboard, including numbers, punctuation, space, backspace, and
clear. The owner chose touch typing; the knob browses results and actions.
Pressing the knob while typing also submits. On this Mac you can type normally;
letters and number keys enter text rather than triggering device shortcuts while
the keyboard is open. Blank and punctuation-only queries cannot submit.

Results reuse Queue's three large rows and playing strip. The query appears in
the header; Edit reopens the keyboard. Tap or press a result for Play now, Play
next, or Add to queue. Play now switches to the player and keeps the upcoming
queue; the other actions insert a new queue entry at the front or end and return
to results. Their confirmation briefly uses the playing strip without covering
track titles. Query, selection, and scroll position survive visiting other views.
Back cancels an edit to an existing query. Empty results offer Edit search.

Search runs only against the six fictional songs already in this preview. Title
matches rank ahead of artist matches; words can match across title and artist,
ignoring accents and punctuation. Try “tidal”, “low”, “motion”, or “a” for a
longer list. No real library search or API request occurs. Search state resets
on reload or simulated factory reset; this pass does not add search history.

Search checks in compact Chrome covered touch and Mac typing, the two keyboard
layouts, both appearances, empty results, result browsing beyond the first three
rows, all three playback/queue actions, duplicate additions, and returning through
Queue and Settings. Model tests cover ranking, normalization, empty matches, and
adding queue entries without replacing existing ones or losing their identities.
Run both suites with `node --test tests/search-preview.test.cjs tests/queue-preview.test.cjs`.

### Queue

Press preset 2 (or keyboard 2) for Queue. Three full-width rows fit above the
current-playing strip, with 34 px titles and 25 px artists. Turn the dial to browse;
tap a row or press the dial for Play next, Move, and Remove. In Move, turn to
preview a position and press to place it. Up/down touch keys also move the track.
Back, Escape, Cancel, or leaving Move discards the draft. Opening Settings and
returning brings you back to Queue. The bottom playing strip returns to the player.

Queue entries have separate identities, including repeated songs. Selection follows
the same entry as playback advances, and confirming or cancelling a move never
restores a song that already started playing. If the track being edited starts,
its edit closes. Action selection also stays on the same command if it becomes
unavailable. Playback consumes the visible queue order; enabling shuffle shuffles
that order. An empty queue offers Playlists and does not invent more tracks.

Refill, Finish track, and Empty queue beneath the device are preview fixtures.
Starting a playlist or choosing an artwork sample creates a fresh sample queue.
All playback and queue mutations are local simulations; the live device and Astra
are unchanged. Keyboard up/down follows list order on Queue; left/right turns the
dial as before. Enter activates a focused button, or the dial when it has focus.

Compact Chrome checks covered both appearances, filled action selection, scrolling,
touch actions, knob moves beyond the first three rows, confirming/cancelling,
Play next, removal, the empty state, and returning through Settings. A simulated
track ending preserved the selected entry and a pending move. Queue state tests
cover duplicate songs, move boundaries, shuffle identity, empty removal, and
commit/cancel after playback advances, including when the moving track starts.
Run them with `node --test tests/queue-preview.test.cjs`.

### Setup and settings

An unpaired preview starts in setup. Find Astra opens discovery, followed by a
computer chooser. Choosing one displays a large code with a matching simulated
Astra approval prompt below the device. Approve/Decline/Expire request exercise
the result states. Discovery controls also cover one computer and none found.
Codes and computer names are fictional. These are design proposals, not a new
pairing protocol or a connection to the real Astra app.

Preview controls exercise first setup, a paired computer, loss of connection,
the boot wordmark, and idle dimming. Simulated pairing is remembered locally;
approval is required to replace an existing pairing, and cancelling retains it.
An expired code cannot approve a connection. A successful connection returns to
the player. Back/M navigate settings and return to the originating screen.

Brightness and idle timeout are remembered. On Display, press the dial on the
brightness rail, turn to adjust, then press to finish. Direct slider input works
too. The first wake gesture is consumed. Brightness is a visual simulation and
does not change this Mac's display or the physical Thing's backlight.

Restart shows a boot preview and retains preferences and pairing. Forget pairing
requires confirmation and keeps appearance. Factory reset uses two confirmations,
clears the simulated pairing and restores Study 05 defaults, then returns to setup.
These actions affect only this study's namespaced local data. They do not reboot,
erase, reflash, or change the real device or Astra app.

Info reads “Made with [pixel heart] by Boof2015.” The heart uses the same 5×4 pixel
shape and pink color as Astra's existing heart, scaled as a crisp local SVG.
The follow-up reduces it to 30×24 px. Navigation rows now use an inverse rounded
fill for the dial, keyboard focus, and touch press, including Connection, Device,
and the computer chooser. Switching input methods keeps one target highlighted.
Choice buttons and sliders keep their distinct focus/selected-value treatments.
Compact checks covered both themes, keyboard-to-dial navigation, destructive row
contrast, and the smaller credit heart.
Playlist selection now uses the same filled contrast: a light tile and dark text
on the shelf's dark canvas, including in the dark appearance. Dial selection,
keyboard focus, and touch press share it. Compact checks covered moving the dial,
tapping a different playlist, and retaining the selection on return.

Chrome checks covered compact setup, settings, appearance, display/dial brightness,
Info, discovery/chooser, matching codes, approval, decline, expiry/retry, cancelled
replacement pairing, saved pairing after reload, reconnect/restore, restart/boot,
reset cancellation and completed reset after reload, forgetting pairing while
preserving appearance, and wake gesture suppression.
JavaScript syntax and local asset references pass. Actual hardware, real protocol
integration, and physical-size legibility remain later work.

## Previous: interface study

Open `language.html` for Study 04. It extends the supported control panel
direction to the header keys, integrated progress rail, active toggle keys,
focus and pressed states, and brief content transitions. The accepted title,
artist, playlist, and transport target sizes are preserved. The timeline has
a 54 px interaction area; playback simulation pauses its clock while scrubbing.

Previous panel / Unified controls compares the treatments in place. Try seek,
shuffle/repeat, keyboard navigation and Enter, and both playlist pages. All data
and playback remain simulated. The complete visual language is still in review.

The owner supports this more intentional direction. The follow-up adds 10 px of
vertical clearance around header keys and matches both pager arrows to stemless
chevrons. Text and transport targets retain their accepted sizes; player artwork
is 236 px to make room while the transport stays anchored.

Open Settings above the dial, or press M, to choose Light/Dark control surfaces
and turn Album color on/off. Preferences persist in this browser's local storage.
The dial selects a setting, its press applies it, and Back/Escape returns to the
prior view and playlist page. These settings affect the local study only.
Backgrounds and keys derive their hue from the sample cover's supplied palette,
with constrained tonal values for contrast. The sample palettes are authored
fixtures; extracting colors from real Astra artwork is not implemented here.

Follow-up Chrome checks covered header/pager spacing, both playlist pages, light
and dark settings/player surfaces, dark playlist selection and volume feedback,
warm/cool and neutral colors, preference persistence after reload, and dial-driven
settings changes. Defaults were restored to Light with Album color on.

Chrome checks covered both views at compact size, pointer seeking (1:27 to 3:09),
active shuffle/repeat keys, keyboard focus, dial paging, immediate activation,
selection restoration on return, long titles, the volume overlay, and in-place
comparison. Syntax and local asset/element references pass. Motion was reviewed
in normal mode; reduced-motion behavior is implemented but has not been exercised
through an OS preference change. Device performance and final physical legibility
remain hardware checks.

## Supported direction: control panel proposal

Open `character.html` for Study 03. The owner accepted Study 02's improved
readability. This proposal preserves its text and target sizes and compares one
new surface treatment against that baseline without changing playback or selection.
A warm lower control panel, a rounded rectangular play key, the volume overlay,
and filled playlist selection share a common treatment. The owner likes this
direction but does not consider it a complete language. All playback remains simulated.

## Accepted scale study

Open `readability.html` for Study 02. It retains Study 01 in `index.html` for
comparison. The owner found the first study too small, dense, and generic.

Study 02 tests hierarchy: 52 px track titles, 30 px artists, 82–86 px transport
targets across the bottom, and a three-cover playlist shelf with 30 px labels.
Secondary album labels and redundant footer information are removed from view.
The volume overlay is retained and enlarged. This does **not** settle the final
visual language; that remains open after explicit feedback that Study 01 felt
generic and like a web app.

The preview starts at a compact scale. Adjust its size to match the real screen
beside the monitor; CSS pixels and zoom alone do not establish physical size.
Use Enlarged view to inspect details, and Long title to inspect text wrapping.

Chrome checks covered the compact player, a two-line title, the three-cover
playlist shelf, second-page navigation, and starting the selected playlist with
Enter. Physical legibility still requires the owner's size calibration and a
later hardware check. Script syntax and local asset/element references pass.

## Previous: visual directions

Open `index.html` directly in a browser. No build, server, API, or credentials are
needed. The canvas is 800×480; the outer hardware frame scales down when needed.

Compare Atmosphere, Studio, and Gallery on both Playing and Playlists. Change
artwork samples to check different palettes. Click a playlist to simulate
starting it. The dial changes volume on Playing and selection on Playlists.

- `1` / `3`: Playing / Playlists
- Left/right arrows: turn dial
- Click the dial: play/pause or select
- Enter: activate the focused control (or dial action when focus is on the page)
- Escape: Playing

Queue and Search are visibly disabled in this small study. All music, playlist
contents, durations, and covers are fictional design fixtures. No real playback
changes occur. The visual directions and input mappings are proposals.

The original Astra wordmark is copied from the local Astra source. Covers are
original SVG fixtures. The live prototype and deployment scripts are unchanged.

## Checked locally

All three directions were visually inspected in Chrome on both Playing and
Playlists. Keyboard dial selection started the selected playlist, returned to
Playing, and preserved selection when reopening Playlists. Dial volume feedback
and warm/cool artwork treatment were also checked. JavaScript syntax, referenced
element IDs, local asset references, and SVG parsing pass. Physical display
readability and hardware performance have not been checked for this study.
