# Easy Video Subtitler

A small, dependency-free **PHP + JavaScript** web app to add styled, animated subtitles to a video.
Load a video, paste your lyrics/script (or an `.srt`), sync it by tapping a key while the video plays,
fine-tune every line on a timeline with audio waveform, pick a font and effects — then let an **ffmpeg** job
burn everything into a new video.

🇮🇹 Italiano: [README.it.md](README.it.md)

## Features

- **Timeline editor** with waveform: drag blocks and edges, snapping, zoom, undo/redo, ±0.1 s / ±0.5 s nudge buttons.
- **Tap-to-sync**: paste one phrase per line, press **Enter** at the start of each phrase while the video plays.
- **Import / export** `.srt`; export `.ass`; export the final video (H.264/AAC `.mp4`).
- **Custom font** (`.ttf` / `.otf`), size, colors, outline, position (global and per subtitle).
- **Text animations** (in and out, with duration in ms, per subtitle): fade, typewriter, pop, bounce, zoom, zoom-from-large,
  slide (4 directions), reveal (wipe), flip, letter-spread, swirl, blur.
- **Text effects**: opacity, shadow, glow, background box, letter spacing — global defaults with per-subtitle overrides.
- **Crop / output size**: choose the output size (presets 16:9, 9:16, 1:1, 4:5…), move/resize the crop box on the preview.
  Subtitles are laid out on the cropped frame. No scaling: the video is only cropped.
- **Faithful preview**: a 12-second ffmpeg render from the playhead, identical to the final export.
- **Projects** saved in a working folder: *File ▸ New / Save / Save as / Replace video / Load / Recent*, optional "reopen last project on start".
- **Replace video**: swap a project's video while keeping subtitles and style (handy for a re-edited cut). It asks for confirmation if duration, resolution or audio differ; with a different resolution the crop is reset. The previous file is deleted, as are derived previews/exports; copies made with *Save as* are untouched.

## Requirements

- PHP ≥ 8.1 (CLI is enough: `./run.sh` uses the built-in server). `exec`/`proc_open` must be enabled.
- `ffmpeg` built with **libass** (the `ass` filter) and `ffprobe`.
- `fc-scan` (fontconfig) to read font metadata.
- A modern browser. No npm / composer dependencies.

## Quick start

```bash
git clone https://github.com/ProffeComics01/easy-video-subtitler.git
cd easy-video-subtitler
./run.sh 8080          # then open http://localhost:8080
```

`run.sh` starts the PHP built-in server with several workers and raised upload limits (4 GB).
For Apache / nginx point the document root to `public/` and raise `upload_max_filesize` / `post_max_size`.

## How it works

```
lib.php            shared helpers: ffprobe, SRT/ASS generation (animations, effects, crop), font metrics
worker.php         system job:  php worker.php <project-id> export|clip|peaks|proxy
public/index.php   UI              public/app.js   editor logic, timeline (canvas), live preview
public/api.php    JSON backend      storage/<id>/   one folder per project (git-ignored)
tests/ass_smoke.php  no-dependency smoke test of the ASS generator
```

Exporting writes `job_export.json` and starts `php worker.php <id> export` in the background. The worker builds
`subs.ass` and runs roughly:

```
ffmpeg -i video -vf "crop=w:h:x:y,ass=subs.ass:fontsdir=fonts" -c:v libx264 -crf N -c:a aac out.mp4
```

Animations are expressed as ASS override tags (`\t`, `\move`, `\fad`, `\clip`…), each subtitle being split into
in / middle / out events; effects such as glow and background box are separate ASS layers.
The editor preview reproduces the same math in JavaScript (`animState()` mirrors `animTags()` in `lib.php`).
The preview is close, not pixel-identical (glow/blur differ slightly): use **Faithful preview** to check.

You can run the job by hand or from cron / a queue: `php worker.php <project-id> export`.

## Configuration

Environment variables: `SUBTITLER_STORAGE` (working folder, default `./storage`), `FFMPEG`, `FFPROBE`, `PHP_CLI`.

## Updating — keep your projects safe

Projects live in `storage/` **inside the app folder**. Before replacing the app folder with a newer version,
copy `storage/` somewhere safe (or set `SUBTITLER_STORAGE` to a folder outside the app).

## Security notes

There is **no authentication**: anyone who can reach the URL can see and delete every project and upload files.
Run it locally, or behind Basic Auth / a VPN / a reverse proxy with login. Keep `storage/` out of the web root
(the document root must be `public/`).

## Tests

```bash
php tests/ass_smoke.php
```

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
