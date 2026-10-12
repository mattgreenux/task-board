# Ideas

Possibilities we aren't planning to work on soon. Some are features that may never happen; others are known work that only starts when something changes (e.g. an App Store release). Conventions are in [CLAUDE.md](CLAUDE.md) under "Task tracking"; planned work is in [BACKLOG.md](BACKLOG.md) and [TODO.md](TODO.md).

When an idea becomes likely, move it to the backlog, placed by urgency.

## If TimeRush goes on the App Store

Not planned (decided 2026-10-11: the app is for personal use for now). The known steps, open questions and risks are in `docs/App-Store.md`, so they aren't listed here one by one.

- Prepare TimeRush for the App Store (`docs/App-Store.md`)

## If a second app starts

- Move the audio and the failsafe notification into the shared package
  - The timer logic moves first (Next Steps); `AudioManager`, `alarm.caf` and `FailsafeNotifier` stay in the app until another app needs them
  - Recommended layout and what to watch for: `docs/Multi-App-Plan.md`

## Feature ideas

- Add an hourglass interface for setting and showing the timer
  - Set the time by dragging up or down; the sand level shows the chosen time
  - Starting the timer flips the hourglass, and sand falls from the top half to the bottom
  - The falling-sand animation lasts exactly as long as the timer
- Change the song when the timer passes 00:00 (with the music feature)
  - Details: `docs/Music.md`
- Let users record their own voice messages
  - The user request that inspired it is quoted in `docs/Talking-Timer-Project_v8.1.md` › Ideas for Future
- Add a setting to run a user-chosen shortcut when a timer starts or ends
  - Why: iOS doesn't let apps add their own Shortcuts automation triggers ("When TimeRush timer starts"), so this stands in for them, e.g. to start a playlist with the timer
  - Downside: the iPhone briefly switches to the Shortcuts app each time. Research how disruptive that is first
- Explore connecting Spotify so a chosen playlist plays when the timer starts
  - Why: for Spotify users; Apple Music comes first because it's simpler
  - What's known so far (SDK vs Web API, Spotify's recent restrictions): `docs/Music.md` › Spotify
- Add Apple Watch support
- Schedule timers in advance
- Start timers a set time before calendar events and speak the event's name
