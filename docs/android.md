# Android app: proposed features

A roadmap for an Android companion to the macOS app. Nothing here is built yet. Each feature names the Android API it
depends on, because that decides what is possible.

## Core: the night lock

| Feature | Android mechanism |
| --- | --- |
| Sleep-hours lock (same schedule as the Mac, default 8 PM – 8 AM) | Full-screen overlay (`SYSTEM_ALERT_WINDOW`) plus an `AccessibilityService` that brings the lock back when another app comes to the front. A true kiosk lock needs Lock Task Mode, which requires Device Owner. |
| Always-allowed apps during the lock | Phone, Messages, Clock and alarms, Maps and emergency calls stay usable. |
| One More Minute, once per night | Same rules as `src/schedule.js`. |
| Passcode for 15 minutes, once per night, after a 30 s delay | Same rules as `src/unlock.js`: scrypt hash, attempt counter, 1-minute lockout. |
| WhatsApp code after the passcode is used | The phone can't send its own approval codes. The Mac app (or a small backend) sends them to `whatsappRecipient`. |
| Tamper resistance | Device Admin to block uninstalling, detection of the accessibility service being turned off, passcode to change settings. Loosening settings needs approval, as in `restrictionChanges`. |

## Entertainment mode

- **Blocked apps** at all times, detected with `UsageStatsManager` or the accessibility service and covered with a
  blocked screen.
- **Blocked sites**, either by reading the URL bar of supported browsers through the accessibility service, or with a
  local `VpnService` DNS filter that also covers other browsers and in-app web views.
- **25-minute session offer** when a blocked app or site is opened, with today's session count and minutes.
- **Kid mode**: 31 minutes once per calendar day, only the kid site or app allowed.
- **Feed blocking** inside otherwise allowed apps (YouTube Shorts, Instagram Reels).

## Pomodoro and ClickUp

- Start from a Quick Settings tile, a home-screen widget or a notification action.
- Ongoing notification with the countdown, in place of the menu-bar title.
- The same task picker as `renderer/pomodoro.html`: due today, search, star, +1, complete, create with `#tags`.
- During focus, turn on Do Not Disturb (notification policy access) and block distracting apps.
- AI focus review from app-usage samples, using the prompt and verdict from `src/activity.js`.

## Phone-specific ideas

- Wind-down reminder 15 minutes before the lock, and grayscale at night where Bedtime mode allows it.
- Nudge when the phone is unlocked again soon after the last time during sleep hours.
- Morning prompt on the first unlock after sleep hours: last night's score and the pomodoro picker
  (as `isMorningPromptDue`).
- Meeting mode: pause blocking and reminders during Zoom or Meet calls.

## Sync with the Mac

- One schedule, passcode and history for both devices.
- One unlock budget: One More Minute used on the Mac is used on the phone too.
- A single night score: phone use during sleep hours counts against the night.
- A shared daily report covering focus, Entertainment and unlocked time on both devices.
- Through a small backend, or over the local network with the Mac as the source of truth.

## Constraints

1. **Google Play policy.** Accessibility API use is reviewed strictly. Expect to justify it, or distribute outside Play.
2. **Battery.** Needs a foreground service and an exemption from battery optimisation; Doze and some vendors' power
   managers otherwise kill it.
3. **Bypasses.** Safe Mode, turning off the service and ADB get around it unless the app is Device Owner, which needs
   a factory reset or ADB provisioning. Like the Mac app, it is a self-control tool, not a security boundary.
4. **Code reuse.** The pure modules (`schedule`, `unlock`, `otp`, `history`, `blocklist`, `pomodoro`, `report`,
   `config`) could be shared through React Native. With Kotlin, they would be ported, with the existing tests as the spec.

## Suggested first version

1. Night lock with passcode and One More Minute.
2. App blocking with Entertainment sessions.
3. History synced with the Mac.

Pomodoro, ClickUp and the AI review follow.
