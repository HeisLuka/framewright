# NEwBOO Video Factory / Codex lab

This repository now has two valid agent workflows. Route by task before touching code.

## 1. NEwBOO factory / Codex lab

Use this path by default when the task mentions NEwBOO, books, ContextPack, CreativeIngress,
C35, campaigns, the video factory, the local render worker, creative optimization, catalog
experiments, or reusable creative primitives.

Do **not** start this kind of work by scaffolding a root `index.html`, running the legacy
interactive brief, or creating a one-off Framewright video.

The canonical production-shaped chain is:

```text
authoritative ContextPack / CopyLanguage
  -> C35 CreativeIngress
  -> C27 NarrativePlan
  -> C19 campaign request / CreativeSpec / RenderSpec
  -> I07 local queue
  -> I03 / FAST physical renderer
  -> MP4 + QA + provenance
```

Read `docs/codex-local-lab.md` before the first NEwBOO creative task.

### Codex lab rules

- Treat publication truth and provenance as authority boundaries. Never invent facts, turn
  intent/click/save evidence into completed reading, or weaken a trust gate to make an idea
  renderable.
- Do not bypass C35/C19/I07/I03 for a production-shaped result. If an experiment needs a new
  capability, change the reusable capability and then come back through the canonical chain.
- Never merge or push experimental work directly into `lab/framewright-research`. Work in a
  local branch/worktree and leave reviewable evidence.
- `NORMAL` mode changes CreativeIngress choices, parameters, and existing primitives.
- `EXPERIMENT` mode may change reusable renderer/compiler/scene/preset/choreography code, but
  must preserve a baseline, candidate output, QA/provenance, measurements where relevant,
  and a concise explanation of the reusable capability being proposed.
- Promote reusable capabilities, not a book-specific one-off HTML fork.
- Render permission is not publication trust, and publication trust is not final external
  platform authorization.
- Verify creative changes from rendered output. A green schema/compiler test is not visual
  evidence.

Useful factory entrypoints:

```bash
npm run check:creative-ingress
npm run factory:run -- --request <campaign.json> --out-dir <dir> --artifact-dir <cache>
npm run local:enqueue -- --request <campaign.json> --workspace .
npm run local:worker -- --workspace . --once
npm run check:i07
```

## 2. Legacy one-off Framewright workflow

Use the workflow below for a standalone handcrafted procedural video that is not a NEwBOO
factory/catalog task.

# framewright

This repository is two things at once: a template project for a short procedural video and
an agent skill that knows how to make one. A video here is a single self-contained HTML file
in which every frame is a pure function of (frame number, seed, output width). Frames are
rendered in headless Chrome, assembled with ffmpeg, and the soundtrack is synthesized in a
script. No footage, no image files, no CDN.

## Start here

1. Read `.agents/skills/framewright/SKILL.md` and follow it step by step. It is the whole
   workflow: environment check, interactive brief, three concepts, storyboard, scaffold,
   scene-by-scene build with visual checks, render, sound, delivery.
   Claude Code loads it as the `framewright` skill (`/framewright`). Codex, Gemini CLI,
   Cursor, Copilot and OpenCode read `.agents/skills/` natively. Any other agent: open the
   file and read it.
2. Run `bash .agents/skills/framewright/scripts/doctor.sh`. If it reports missing tools,
   tell the user what would be installed, get a yes, then run it with `--install`.
3. Ask the brief before writing any video code. Propose three concepts. Get a pick. Only
   then scaffold.

## Repository map

```
AGENTS.md                         this file, read by most agents
CLAUDE.md, GEMINI.md              one-line imports of this file for Claude Code and Gemini CLI
.gemini/settings.json             tells Gemini CLI to read AGENTS.md
.agents/skills/framewright/       the skill: SKILL.md, references/, scripts/, assets/
.claude/skills/framewright        symlink to the skill for Claude Code
examples/ris-tv/                  a finished 40-second video: index.html, audio.mjs, previews
package.json                      npm scripts and the puppeteer dependency for this folder
```

After `bash .agents/skills/framewright/scripts/init.sh` the working files appear in the
root: `index.html`, `audio.mjs`, `storyboard.md`, `scripts/`. That is where the video is
built when the user works inside this clone.

## Rules for every agent

- Never put image, video or font files, base64 or CDN links into the HTML. Polygons traced
  from a photo by `scripts/trace.py` are data and are allowed.
- Verify by rendering frames and looking at them (`node scripts/look.mjs shot ...`,
  `... sheet ...`). Never conclude from reading code that a frame looks right.
- Build one scene at a time. A contact sheet of the whole video comes before the full
  render.
- Scene lengths are multiples of the beat. Sound is written last, to the locked lengths.
- Keep helpers above the plates block in `index.html`.
- Never commit `frames/`, `shots/`, `*.mp4`, `*.wav`, `portrait.js` or the user's photos.
  The `.gitignore` already excludes them; do not weaken it.
- Ask before installing system packages. Ask before publishing anything that shows a real
  person.

## Commands

```bash
bash .agents/skills/framewright/scripts/doctor.sh [--install]   # toolchain
bash .agents/skills/framewright/scripts/init.sh                 # scaffold index.html, scripts/, audio.mjs
npm install                                                     # puppeteer
node scripts/look.mjs shot 0,30,60 1200 7                       # frames to look at
node scripts/look.mjs sheet 24 480 7 shots/sheet.png            # contact sheet
node scripts/render.mjs frames 7 1920 5 && bash scripts/build.sh out.mp4
bash scripts/make.sh [photo.jpg]                                # portrait, audio, render, build in one go
```

## The example

`examples/ris-tv/index.html` is a complete video in the retro TV style: power-on, test
card, a countdown that breaks, two teletext pages, an oscilloscope, a portrait that locks in,
power-off. Read it as a worked example of plates, helpers, transitions and post-processing.
Its portrait block holds a synthetic placeholder; real projects generate that block from a
photo. Render it with
`HTML=examples/ris-tv/index.html node .agents/skills/framewright/scripts/look.mjs sheet 24 480 7 shots/example.png`.
