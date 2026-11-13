# Contributing to Easy Video Subtitler

Thanks for your interest! Bug reports, ideas and pull requests are welcome.

## Getting started

1. Fork and clone the repository.
2. Install PHP ≥ 8.1, `ffmpeg` (with libass), `ffprobe` and fontconfig (`fc-scan`).
3. Run `./run.sh 8080` and open <http://localhost:8080>.
4. Run the tests: `php tests/ass_smoke.php`.

## Where things are

| Area | Files |
| --- | --- |
| ASS generation (animations, effects, crop), SRT, ffprobe, font metrics | `lib.php` |
| Background jobs (export, faithful preview clip, waveform, proxy) | `worker.php` |
| JSON API and file serving | `public/api.php` |
| Editor UI, timeline, live preview | `public/index.php`, `public/app.js`, `public/style.css` |

## Important design rules

- **Preview and export must agree.** Anything animated or styled in the editor is computed twice: in JavaScript
  (`animState()`, `renderOverlay()` in `app.js`) and as ASS in `lib.php` (`animTags()`, `subsToAss()`). When you change one,
  change the other and compare with *Faithful preview* (ffmpeg render) on a real video.
- Sizes are relative to the **output** frame height (percent), so styles survive cropping and different resolutions.
- Keep it dependency-free: plain PHP, plain JS, no build step.
- Validate every input in `api.php` (ids, extensions, numbers, colours) and never put user data in shell strings without `escapeshellarg()`
  or an argument array.
- User data (`storage/`) must never be committed.

## Pull requests

- Keep PRs focused; describe what changed and how you tested it (screenshots help for UI work).
- Add or update a case in `tests/ass_smoke.php` when you touch ASS generation.
- By contributing you agree your work is released under the [MIT license](LICENSE).

## Ideas welcome

Possible next steps: authentication, a work queue for many parallel exports, more animations (e.g. per-word/per-letter effects),
subtitle styles presets, MicroDVD `.sub` import.
