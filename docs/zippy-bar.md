# Zippy bar — one menu bar item for the whole suite

Like Creative Cloud: a single icon in the macOS menu bar lists every Zippy app installed on the
Mac, shows which ones are running, and on hover opens each running app's own panel. Every Zippy
app embeds the same code (`apps/macos/Sources/ZMail/ZippyBar.swift` in ZMail); whichever starts
first draws the bar, the others only publish their panel. There is never more than one icon.

## Protocol

Messages go through `DistributedNotificationCenter` (same user session, no server). `userInfo`
is a `[String: String]`; every message carries `bundleId` (the sender).

| Notification | Extra keys | Meaning |
|---|---|---|
| `com.zippy.bar.hello` | — | An app starts. The current leader answers `leader`. |
| `com.zippy.bar.leader` | — | "I draw the bar." Receivers remove their own status item and publish their panel. |
| `com.zippy.bar.panel` | `panel`: JSON `[{id, title, enabled, separator}]` | An app's hover panel. Re-send whenever it changes. |
| `com.zippy.bar.action` | `target`, `id` | The leader asks `target` to run panel item `id`. |
| `com.zippy.bar.resign` | — | The leader quits. Others wait 50–250 ms at random; the first to claim `leader` wins. |

Start-up: post `hello`, wait 400 ms; with no `leader` reply, become the leader.

## Adopting it in another Zippy app (e.g. ZFlow)

1. Copy `ZippyBar.swift` (it has no ZMail dependency) into the app.
2. Replace the app's own `NSStatusItem` by `ZippyBar(ownPanel:onAction:)`: `ownPanel` returns the
   items of today's menu (ZFlow: Start Dictating, Paste Again, History…), `onAction` runs them.
3. Add the app to `ZippyBar.suite` with its bundle id, and ship. Order and taglines must match
   `apps/mail/lib/zippy-suite.ts` (the in-app promotion catalogue).

Until an app adopts it, the bar still lists it (detected by bundle id) with Open / Quit, and apps
not installed appear under « Découvrir » with a link to their repository.
