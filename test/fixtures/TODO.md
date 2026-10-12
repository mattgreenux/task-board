# TODO

Conventions are in [CLAUDE.md](CLAUDE.md) under "Task tracking". Planned work that isn't next yet is in [BACKLOG.md](BACKLOG.md), and ideas in [IDEAS.md](IDEAS.md).

## Next Steps

1. Set up the task board and try it on the desktop and the iPhone
   - Steps: `docs/Task-Board.md` › Setup (turn on GitHub Pages, run the workflow, add a token on each device)
   - Acceptance: the lists load, and an edit, a drag and a move between lists each save as a commit that leaves the rest of the files unchanged
1. Move the main screen's controls higher up
   - Why: with the buttons right at the bottom edge, the screen looks and feels awkward
   - Start button: at least a quarter of the way up from the bottom. Wheel and time display: a little higher too; Claude picks how much by comparing simulator screenshots (the user refines later if needed)
   - Leave the Cancel and Stop buttons where they are now. They then won't line up with the Start button; that's intentional
   - Acceptance: simulator screenshots idle, running and in overtime, at the default and a large text size, with nothing clipped
