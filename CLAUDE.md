@AGENTS.md

## Claude Code notes

- The skill loads automatically from `.claude/skills/framewright` (a symlink to `.agents/skills/framewright`). Invoke it with `/framewright` or just describe the video you want.
- Use `AskUserQuestion` for the brief and for every decision point the skill marks as a checkpoint. Group up to 4 questions per call, mark the recommended option.
- After each contact sheet or key frame, send the image to the user with `SendUserFile` when that tool exists; otherwise name the file path.
