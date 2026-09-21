# Astra Thing design direction

## Agreed scope

- Playback control, upcoming queue control, browsing and playing playlists,
  and searching and playing/enqueueing songs.
- Full library browsing remains a desktop responsibility.
- Add bounded playlist enumeration to Companion API v2; playback uses existing
  intents. A browsable playlist shelf must not be presented as supported today.
- Make hardware companions a dedicated Astra integration, reusing discovery,
  secure pairing, remembered identities, scopes, and v2 music operations.
- Target plug in, discover, approve the first connection, then automatic
  reconnection. Exact first-pairing handshake is still an engineering decision.
- Keep shared connection support independent of Car Thing display/input details
  so future custom hardware can reuse it.

## Visual direction

The owner wants a new, coherent hardware interface. Astra fullscreen and the
original Car Thing are inspirations, not templates. The supplied fullscreen
screenshot is one reference, not a specification for every screen.

Consistency in typography, spacing, shapes, focus, touch targets, motion, and
physical input response is a major part of the desired premium feeling. Do not
assume the desktop Astra styling can simply be scaled down to this touchscreen.

The owner approved the visual language and core interactions after Study 04.
Use that foundation for subsequent screens. The earlier studies below preserve
the decisions and feedback that led to this direction.

### Feedback on Study 01

The owner rejected the first layout as too small and dense for the physical
display, despite looking acceptable enlarged. The volume overlay was a useful
exception. References of original Car Thing screens demonstrate stronger visual
hierarchy and larger elements; they are not instructions to copy Spotify.

The visual language also feels generic and like a web app, lacking personality.
Color/font/corner variations around the same generic composition do not resolve
that criticism. Readable proportions and a distinctive visual language are both
requirements. Study 02 isolates the former; its styling is not an approved final
direction. Design judgments must include a compact preview matched manually to
the real display, then eventual checks on hardware at normal viewing distance.

### Accepted scale from Study 02

The owner explicitly confirmed the revised size is much more readable. Retain
52 px primary track text, 30 px artist text, large 82–86 px transport targets,
and three large playlist covers with 30 px names as the working baseline.
Do not treat this approval as approval of the visual language or final hardware QA.

### Supported direction from Study 03

The owner likes the solid control panel direction and finds the changed areas
more intentional. This supports continued exploration, not approval of a complete
visual language. The warm lower panel, inset play key, related volume overlay,
and filled playlist selection begin to share recognizable rules.

Study 04 applies these rules to the header, progress control, focus, active keys,
pressed feedback, and short navigation transitions. It preserves the accepted
text/target scale and includes an in-place comparison with Study 03. Its timeline
and transport occupy one anchored control surface. Music changes and navigation
move content briefly while the control surface stays anchored. Reduced-motion
preferences are respected. The owner explicitly requested this pass; the result
still needs eventual physical-device checking.

### Feedback on Study 04

The owner strongly supports this direction as more intentional. Continue to
develop it as a coherent hardware language. Their requested refinements are
breathing room around the top-right keys, matching stemless navigation chevrons,
album-derived color instead of fixed green, and appearance options in Settings.

The local preview now provides Light/Dark control surfaces and Album color on/off
behind the simulated hardware Settings key (M). These preferences are remembered
locally and applied consistently to transport, selection, readouts, and settings.
Artwork palette hue is constrained into readable surface/ink roles; direct live
artwork palette extraction remains integration work. Header clearance comes from
a small artwork reduction while accepted type/target sizes and transport position
stay fixed. This is a preview refinement, not a device deployment.

## Proposed interactions, still open

- Four top buttons: Playing, Queue, Playlists, Search.
- Dial: volume on Playing; selection in lists; press to toggle/select.
- Front button: back; settings button: device settings.
- Playlist activation: start playback and return to Playing, preserving the
  playlist selection when revisiting it.

The study explores these interactions; it does not finalize the mappings.

## Setup and settings pass

The owner requested Settings and pairing before Queue and Search. Study 05
(`design-preview/companion.html`) covers:

- Connection: current computer/status, pair another, forget pairing, reconnect.
- Appearance: light/dark control surfaces and album-derived color on/off.
- Display: brightness, idle dimming, and a wake gesture that consumes its input.
- Device: restart with retained settings; factory reset with two confirmations.
- Info: preview identity and “Made with [pixel heart] by Boof2015.” Use Boof2015
  for the credit. The pixel heart matches the existing Astra shape.
- First setup, discovery, computer selection, large matching code, approval,
  success, rejection, expiry/retry, no computer found, and lost connection.
- A restrained centered Astra wordmark for boot/restart.

Pairing UX is simulated locally, including an illustrative Astra-side approval
prompt. Existing pairing survives a cancelled replacement attempt. Actual secure
pairing/discovery must reuse the established v2 foundation; the visual code and
fixture events here are not a security implementation. Reset affects the local
preview only; its eventual device meaning is clearing pairing and preferences
while keeping Astra Thing installed and leaving host music alone.

The owner likes Study 05 overall and requested two small refinements: a smaller
credit heart and inverse filled rectangles for knob navigation, consistent with
the transport's active keys. Menu rows share this fill for dial selection,
keyboard focus, and touch press. Apply it to related navigation lists; preserve
the distinction between navigation focus and saved values on form controls.

The owner also requested this contrast treatment for the playlist shelf. Use a
light filled tile with dark text for the selected playlist in either appearance,
since the surrounding shelf stays dark. Dial, keyboard, and touch use this same
selection treatment.

## Queue: checking and quick adjustments

The owner wants Queue to be a vertical list of large rows. Their main use is
checking what is coming, with occasional moves or removals. Keep advanced and
bulk editing in desktop Astra. The approved interaction is a row action panel
and a separate move mode using the knob, with equivalent touch controls.

The current local preview shows three full-width rows above the playing strip.
Titles are 34 px, artists 25 px, artwork 76 px; the selected row uses the same
cream fill and dark text as the playlist shelf. Tap or press for Play next, Move,
or Remove. In Move, the selected track changes position with the dial or large
up/down keys. Press/Place here commits; Back/Cancel discards the draft. The playing
strip returns to the player, and Settings returns to the queue that opened it.

Playback and editing operate on queue-entry identity rather than song identity.
Selection survives earlier tracks starting, duplicates stay separate, and an
unconfirmed move cannot restore consumed entries. If the edited track starts,
the action or move panel closes. The empty state directs the user to Playlists.
All of this remains a local fixture-driven prototype, pending API v2/device
integration. The owner accepted this Queue direction.

## Search: find a song, then choose an action

The owner chose touch typing, with the knob used for browsing results. The local
preview gives typing a dedicated screen: a 76 px query field and four rows of
62 px keys, using the existing light/dark control surfaces and inverse presses.
Numbers, punctuation, backspace, space, and clear are included. Mac keyboard
input is available for trying the preview. No knob-driven letter picker is added.

Submitting replaces the keyboard with three large results, reusing Queue's row
scale, selection treatment, and playing strip. The header keeps the query and an
Edit key. A track opens Play now, Play next, and Add to queue. In the approved flow,
Play now starts that song while keeping the upcoming queue; the other actions
insert at the front or end and leave the user in results. Their confirmation uses
the bottom strip briefly. Returning to Search retains query, selection, and scroll.
An empty result offers another edit; Back cancels edits to an existing query.

The results are songs matched by title or artist, not a full library browser.
Search is currently synchronous over fictional fixtures. Real API v2 search,
request/loading/error behavior, and hardware typing checks remain integration work.
The owner accepted this Search pass. The local preview is now the approved
reference for the first complete interface: Playing, Playlists, Queue, Search,
setup/pairing, Settings, and the boot treatment. Preserve its hierarchy and
interaction language during implementation; physical-device checks may still
require refinements to typing, readability, motion, and input behavior.
