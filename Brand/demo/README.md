# README demo

The source of `Brand/readme/zmail-demo.webp`, the animation at the top of the README. Every screen in
it is the real ZMail UI, in English, captured from the demo engine: the unified inbox sorted by
the AI, the Free / Business / Ultra modes, an OTP code copied from the notification, a reply
whose documents the assistant found on the Mac, ZMail run from an AI assistant over MCP, the
themes, then the lockup with "Your inbox, on autopilot."

It is a [HyperFrames](https://github.com/heygen-com/hyperframes) composition, built with the
[Herk Edit Kit](https://github.com/nateherkai/herk-edit-kit) and its motion rules, following
the Zippy `zippy-demo-video` skill. Nothing here is part of the app.

| File | What it is |
|---|---|
| `capture.mjs` | Drives the real app with Playwright and writes `captures/*.png` plus `captures/boxes.json` (where the elements the camera aims at are). |
| `demo-files.mjs` | Writes the two PDFs the assistant attaches, in `~/Documents/ZMail Demo`. |
| `index.template` | The composition: scenes, camera over the captures, centred titles, timeline. |
| `build.py` | Fills the template from the captures and writes `index.html`. |
| `DESIGN.md` | Palette, type and what not to do. |

## Re-render

You need Node 22+, FFmpeg, Chrome, Python 3, Docker (the test mail server), an AI connection in
ZMail.app (ZenMux), and the Zippy `brand-kit` next to this repository.

1. **Herk Edit Kit:** in a checkout, `npm ci`, `npx hyperframes telemetry disable`, then
   `npm run new-video -- zmail-demo`. Copy `index.template` and `build.py` into
   `video-projects/zmail-demo/`. Assets: Plus Jakarta Sans 500/700/800 and JetBrains Mono 400
   from `brand-kit/fonts/` into `assets/fonts/`, `Brand/variants/zippy/icon.svg` as
   `assets/zmail-icon.svg`, `node_modules/gsap/dist/gsap.min.js` into `assets/`, and the lockup:
   `python3 ~/.claude/skills/zippy-readme/scripts/hero.py --kit <brand-kit> --slug zmail --out assets --inline`.
2. **The English demo engine:** `pnpm testmail:up`, `pnpm --filter @zmail/ui build`, then start
   `demo-engine-en` from `.claude/launch.json` once (it seeds the English mailboxes), stop it,
   copy the AI connection with
   `pnpm --filter @zmail/engine exec tsx scripts/copy-ai-connection.ts /tmp/zmail-demo-en`,
   and start `demo-engine-en-keep`. Set the mode to Business in *Settings → AI*. Don't run the
   engine tests meanwhile: they reseed the same mail server in French.
3. **Captures:** `node Brand/demo/demo-files.mjs <kit dir>`, then
   `node Brand/demo/capture.mjs <kit dir> <kit>/video-projects/zmail-demo/captures`. Look at the
   PNGs. Delete `~/Documents/ZMail Demo` afterwards.
4. **Render:** in the project, `python3 build.py`, `npx hyperframes lint` (0 warnings),
   `npx hyperframes render --quality high --fps 30 --output renders/zmail-demo.mp4`, and review
   contact sheets around every transition.
5. **Export** (under 5 MB):

   ```bash
   ffmpeg -i renders/zmail-demo.mp4 -vf "fps=15,scale=960:-1:flags=lanczos" -c:v libwebp -lossless 0 -q:v 40 -compression_level 6 -loop 0 -an zmail-demo.webp
   ```

An animated WebP rather than a video, so the README plays it on its own, with no play button,
and rather than a GIF, which is several times heavier.
