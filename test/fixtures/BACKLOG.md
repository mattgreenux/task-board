# Backlog

Planned work that isn't in Next Steps yet, roughly in priority order (most urgent first). Conventions are in [CLAUDE.md](CLAUDE.md) under "Task tracking"; committed work is in [TODO.md](TODO.md), and ideas we aren't planning yet are in [IDEAS.md](IDEAS.md). The big picture is in [docs/Roadmap.md](docs/Roadmap.md).

- Define the boundary between the core talking timer and TimeRush-only features
  - Why: other apps will build on the talking timer; this decides what goes in the shared package and which ideas belong to other apps
  - Decided one feature at a time: before building a feature, ask "core or this app only?" (`docs/Multi-App-Plan.md` › Recommendation)
  - Plan and open questions: `docs/Multi-App-Plan.md`
- Add a small elapsed-time display that appears after 00:00 and counts up from the start (a 10-minute timer at `-00:01` shows `10:01`)
  - Details: `docs/Overtime.md`
- Explore ways to improve what happens when the user stops the timer, before and after 00:00
  - For now: Cancel before 00:00 and Stop after both go straight back to the minutes wheel (`docs/Overtime.md`), which is fine to start with
- Optionally speak the current time of day
- Add or subtract time from a running timer
- Tap the time to hear it spoken on demand
- Let the user set custom announcement intervals
- Let the user choose a different end-of-timer sound or message
- Let the user customize the spoken time format
- Move audio-session calls off the main thread to clear Xcode's "AVAudioSession Hang Risk" warnings
  - Why: slow replies from iOS's audio process could briefly freeze the screen (countdown stalls, Cancel slow). Nobody has seen it happen; the audio would behave the same, not faster
  - Risk: ordering bugs in the new code could break ducking or leave the keep-alive running after Cancel, and no automated test covers `AudioManager`, so it needs an iPhone re-check. Best done in a device session with other audio checks
  - Details, proposed fix, pitfalls and checks: `docs/Audio-Hang-Risk.md`
  - Possible sighting (2026-10-08, simulator): with `-debugAutoStartSeconds 3`, the "1" was spoken ~1.8 s late and the alarm right after it, in two separate runs; the main thread was busy just after launch. Cause not checked
- Add a simple checklist in the same view as the timer
  - Each app keeps its own checklist items, with no syncing between apps (`docs/Multi-App-Plan.md`)
- Decide the open questions about checkpoints (editing while running, after the last item, the Live Activity)
  - Questions: `docs/Checkpoints.md` › Open questions
- Add checkpoints: give each checklist item its own time limit and run them one after another
  - Checking off an item starts the next item's timer; an unchecked item keeps counting past 00:00 until it's checked
  - Needs the checklist and the decisions above first
  - Behavior: `docs/Checkpoints.md`
- Add Siri and Shortcuts actions: start a timer for X minutes, stop it, add or subtract time, get the time left
  - Both come from one Apple system (App Intents): each action is written once and works in Siri and the Shortcuts app
- Decide what happens if the chosen playlist is gone, the music app isn't available, or the user isn't signed in
  - Questions: `docs/Music.md` › Open questions
- Start a chosen Apple Music playlist when the timer starts
  - Behavior (keeps playing after 00:00; stops on Cancel, Stop or the overtime cutoff; never stops music another app started) and how: `docs/Music.md`
