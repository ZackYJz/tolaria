# Tolaria Web: deliberate UI departures

Standing rule (Luca, 10 Oct 2026): Tolaria Web reuses the desktop shell, BlockNote editor, components, tokens, typography, icons and dark mode. Where the web demands something different, the change is made deliberately and recorded here: what, why, where. Karn copies this list into the vault note `tolaria-vault-remote-v1`.

## Departures made

Spike S4 (TOL-8) adds the first web-only surface, the collaborative note page. It reuses the editor, its theme, the shadcn components and the design tokens; the departures are in the table.

Spike S3 (TOL-5) adds the server and the protocol package and touches no UI.

Spike S1 (TOL-3, TOL-4) builds the existing shell as a static web bundle without changing any component, style, token or copy. `apps/web/` contains build and test configuration only.

| Date | What changed | Why | Where |
|---|---|---|---|
| 12 Oct 2026 | A standalone collaborative note page (`/apps/web/collab.html?note=<path>`) instead of the three-pane shell | The shell swaps markdown into one editor instance; a live document needs an editor created for it. A page of its own proves the multiplayer path first and works on a phone, which the shell does not yet | `apps/web/collab.html`, `apps/web/src/collab/` |
| 12 Oct 2026 | Presence avatars in the note header: overlapping circles with initials, coloured per person, name in a tooltip, the viewer marked "(you)" | Multiplayer UI ships in the first beta; the desktop has no notion of other people | `apps/web/src/collab/PresenceAvatars.tsx` |
| 12 Oct 2026 | Live cursors and selections of other people in the editor, labelled with their name while they are active | Same. BlockNote's collaboration cursors with their default styling, in the person's presence colour | `apps/web/src/collab/CollabEditor.tsx` |
| 12 Oct 2026 | A sync status badge ("Connecting…", "Syncing…", "All changes synced", "Offline. Your changes are kept…") in place of the desktop status bar's git controls | On the web the user does not commit or push; what matters is whether edits have reached the server | `apps/web/src/collab/CollabStatusBadge.tsx` |
| 12 Oct 2026 | A notice naming the conflict copy when edits could not be merged with a change from another device | The desktop resolves conflicts in a git dialog; here the server has already kept both versions | `apps/web/src/collab/CollabStatusBadge.tsx` |
| 12 Oct 2026 | A connect form asking for server token, name and note path | Stand-in for login and navigation, which belong to later work; the token stays in session storage | `apps/web/src/collab/ConnectForm.tsx` |
| 12 Oct 2026 | Note header and editor laid out with `100dvh` and safe-area insets; avatars are not focus targets (name exposed as an image label) | Phone browsers: virtual keyboard, notch, no hover | `apps/web/src/collab/collab.css` |

## Known gaps that will become departures

Found while running the unchanged shell in a browser and in iPhone and iPad emulation. They are listed so the first web UI work starts from evidence; none of them has been changed. Details and measurements are in [s1-tauri-inventory.md](s1-tauri-inventory.md).

| Area | What the unchanged shell does on the web | Likely adaptation |
|---|---|---|
| Phone layout | Three fixed panes; the editor is off-screen at 393 px and cannot be reached by touch | Single-pane stack with back navigation |
| iPad portrait layout | Editor pane clipped on the right at 834 px | Two panes, collapsible sidebar |
| Navigation | No URLs; state is lost on reload | Deep-link URLs for vault, note and view, with back and forward |
| Shortcuts and empty state | Advertises `⌘P / ⌘O / ⌘N`, which browsers own | Command palette first; browser-safe shortcuts; touch-first empty state |
| Status bar | Git branch, changes, commit, sync and history controls | Sync and connection status, including offline and conflict states |
| Web-only surfaces | Absent | Login, account, sharing and permissions dialogs, add to home screen |
| Multiplayer | Present on the collaborative note page (S4); absent in the shell | Bring the page's presence, cursors and status into the shell; sharing state |
| Touch | Hover-revealed controls and right-click menus | Touch targets, long-press menus, virtual keyboard and safe-area handling |
