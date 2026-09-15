# RIS TV

A finished framewright video: a 40-second deadpan question addressed to a streamer,
rendered as a television that has nothing to show. Eight plates, 1200 frames at 30 fps,
120 BPM, one 45 KB HTML file, a synthesized soundtrack.

| # | plate | bars | what happens |
|---|---|---|---|
| 1 | on | 2 | the tube powers on, snow, a blinking NO SIGNAL box |
| 2 | card | 2 | a test card with a station ID and a "waiting for N days" counter that accelerates |
| 3 | count | 2 | a seven-segment countdown reaches 00:00 and breaks into ??:?? |
| 4 | ask | 4 | teletext page 100: the question, one line per bar |
| 5 | ask2 | 3 | teletext page 101: a wish list for the stream |
| 6 | clip | 2 | an oscilloscope traces a paperclip, a sweep finds "streams: 0" |
| 7 | ris | 4 | the signal locks onto a portrait: wireframe, fills, lower third, "WHEN?" |
| 8 | off | 1 | the picture collapses to a line, a dot, an end card |

`index.html` shows the full CRT post-processing pass (barrel, chromatic aberration, scan
lines, vignette, grain, bloom), bitmap text, a parametric test card, a seven-segment
display, an oscilloscope graticule, channel-switch transitions, an RGB-split portrait and a
power-off that reuses the previous plate's last frame. `audio.mjs` is the soundtrack: hum,
hiss, test tone, beeps, a beat under the teletext, a pad under the portrait, a thunk at
power-off.

The portrait block between `/*PORTRAIT_START*/` and `/*PORTRAIT_END*/` holds a synthetic
placeholder in this public copy. In the original, `scripts/portrait.sh photo.jpg` generated
it from a photo.

Render it from the repository root:

```bash
npm install
HTML=examples/ris-tv/index.html node .agents/skills/framewright/scripts/look.mjs sheet 24 480 7 shots/example.png
HTML=examples/ris-tv/index.html node .agents/skills/framewright/scripts/render.mjs frames 7 1920 5
( cd examples/ris-tv && node audio.mjs ../../track.wav )
bash .agents/skills/framewright/scripts/build.sh out.mp4
```

Or open `index.html` in a browser for a live preview; add `?f=900&w=1200` to see one frame.
