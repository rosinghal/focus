# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org).

## [1.4.0] - 2026-10-22

### Added

- **⌥⌘P** opens Pomodoro from anywhere: the task picker, or the timer while a pomodoro or break is running.

## [1.3.0] - 2026-10-22

### Added

- Settings shows the app version in a small footer.

## [1.2.0] - 2026-10-22

### Added

- Pomodoro: a star on each task marks it high priority in ClickUp, or clears its priority. Starred (urgent or high)
  tasks are listed first.

## [1.1.1] - 2026-10-22

### Changed

- README pomodoro screenshot shows the new-task tile and **Create and start**.

## [1.1.0] - 2026-10-22

### Added

- Pomodoro: **Create** on the new-task tile adds the task to ClickUp without starting a pomodoro.

### Changed

- Pomodoro: typing a goal clears the previous results right away and shows the new-task tile while searching. The
  main button reads **Start** for an existing task and **Create and start** for a new one.

## [1.0.0] - 2026-10-22

First public release, macOS only.

### Added

- Sleep-hours lock on every display (default 8 PM – 8 AM) with One More Minute once per night, a 4-digit passcode
  for 15 minutes once per night (after a 30-second wait), then 6-digit WhatsApp codes sent to a number you set.
  Five wrong attempts lock the keypad for a minute. **Lock Now** in the menu bar ends an unlock early.
- Last 7 nights on the lock screen: nightly focus score, perfect nights, average and streak.
- Settings in Schedule, Modes and Passcode tabs. Settings and Quit are disabled during sleep hours; loosening
  changes (shorter sleep hours, unblocked sites or apps, a new passcode or WhatsApp recipient) need a WhatsApp code,
  or the passcode while WhatsApp isn't set up. Quit asks for the passcode.
- Entertainment mode: blocked sites (Safari, Chrome, Brave, Edge, Arc, Vivaldi, Chromium) and apps at all times, with
  an offer of 25 minutes where only they work and other apps are hidden.
- Kid mode: stick.cafe is always blocked and offers 31 minutes once a day where only it works.
- Pomodoro: 25 minutes on a ClickUp task (picked from tasks due today, searched as you type, or created), a 5-minute
  break, an always-on-top timer, and a summary with **Mark task complete**.
- Meeting mode: during a Zoom meeting or Google Meet room, a reminder after a minute away, with **Back to meeting**
  and **I'm presenting**.
- Menu-bar countdown while a mode, pomodoro or unlock is active.
