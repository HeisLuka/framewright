# R29 — Audio/mux boundary scout

I02 measured the current WebCodecs `audio encode + MP4 mux` stage at roughly 0.67–0.78 seconds, about 15–17% of full job wall on the same-scene 1080x1920 scout. R29 isolates that boundary before adding another mux implementation.

## Cheap scout

One 12-second 1080x1920 H.264 elementary stream is generated once outside the timed loop. One 12-second PCM WAV is also generated once. A canonical AAC/M4A artifact is encoded once before measurement.

The timed comparison is interleaved over 25 repetitions after warmup:

```text
A current_wav_aac_mux
H264 + WAV -> FFmpeg video copy + AAC encode + MP4

B cached_aac_copy_mux
H264 + canonical AAC/M4A -> FFmpeg video/audio stream copy + MP4

C video_only_mux
H264 -> FFmpeg video stream copy + MP4
```

Measure p50/p95 wall, child CPU, peak RSS, output bytes, ffprobe A/V duration and elementary video hash.

## Decision logic

- A -> B measures the avoidable per-video AAC encode boundary.
- B -> C approximates residual audio-container work on top of video-only mux.
- If B remains at least 200 ms or about 5% of the current full-job wall, a bounded in-process/browser mux scout is justified.
- If B is small, do not add Mediabunny or another mux stack merely to shave tens of milliseconds.

The first in-process candidate, if the gate clears, is Mediabunny rather than deprecated `mp4-muxer`; it can target MP4 with AVC/AAC in browser or Node. That is a later bounded pass, not assumed faster in advance.

## Important caveat

Synthetic H.264 content is acceptable for this boundary scout because video is stream-copied; its purpose is to isolate process/audio/container overhead. Any winning policy must still be integrated into the real WebCodecs path and re-measured end-to-end before changing production economics claims.
