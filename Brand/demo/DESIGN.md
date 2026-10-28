# ZMail README demo

## Style Prompt
A silent 30-second film for the README that shows the real ZMail, in English, the way people use
it. Each feature opens on a title in the middle of the screen, the app blurred and dimmed
behind it, then the camera moves over the real UI: every inbox in one list, the AI's tags, the
Free / Business / Ultra modes, an OTP code copied from the macOS notification and pasted into a
sign-in page, a reply whose two documents the assistant found on the Mac. Then ZMail run from an
AI assistant over MCP, the inbox in eight themes, three "100%" promises, and the Zippy/ZMail
lockup with "Your inbox, on autopilot." Near-black canvas lit by one red glow.

## Colors
- `#08070A` canvas (ink)
- `#FC2832` ZMail red: the brand (glow, highlight rings)
- `#FF8A8F` red light: emphasis words on black
- `#FFFFFF` type on black
- Everything inside a capture is the app's own colours.

## Typography
- Plus Jakarta Sans 500/700/800 (the Zippy brand face) for titles and copy
- JetBrains Mono 400 for the machine layer (HUD, codes, tool calls)
- The macOS notification uses the system font, as macOS draws it

## What NOT to Do
- No hand-drawn app screens: every ZMail screen is a capture of the real app (`capture.mjs`).
- No titles in a corner: feature titles sit in the middle of the screen.
- No real people, companies or mail: the demo mailboxes are invented. The only real names are
  the AI clients ZMail connects to over MCP.
- No `background-clip: text`, no emoji glyphs (grey boxes in capture), no `Math.random()`.
