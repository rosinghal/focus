# Focus

A macOS menu-bar app that locks every screen during sleep hours (default 8 PM – 8 AM), modelled on Apple Screen Time.
It also blocks entertainment sites and apps around the clock, runs ClickUp-backed pomodoros and nudges you back into
meetings.

![Lock screen](docs/screenshots/lock.png)

## Why

Screen Time is easy to dismiss on a Mac. Focus covers every display with a full-screen lock you can only get past in a
few deliberate ways, and keeps a nightly score so you can see how you're doing.

## Features

### Sleep-hours lock

- **One More Minute** — 1 minute of access, once per night.
- **Enter Passcode** — after a 30-second wait, a 4-digit passcode gives 15 minutes, then it locks again. Works once
  per night.
- **Ask via WhatsApp** — after the passcode is used, every further 15 minutes needs a 6-digit code sent over WhatsApp
  to someone you trust (set their number in Settings). Codes expire after 5 minutes and work once.
- **Lock Now** — done early? Pick it from the menu-bar icon to lock straight away.
- **Last 7 nights** — each night's focus score (share of sleep hours that stayed locked), a ✓ for perfect nights with
  no unlocks, your average and your current streak.

Five wrong passcodes lock the keypad for a minute. Settings and Quit are disabled during sleep hours, and outside them
Quit asks for the passcode.

### Entertainment mode

<img src="docs/screenshots/blocked.png" alt="Blocked site offer" width="420" align="right" />

List entertainment websites and apps in Settings and they're blocked at all times. Tabs on a blocked site (or its
subdomains) switch to a "blocked" page in Safari, Chrome, Brave, Edge, Arc, Vivaldi and Chromium, and blocked apps are
quit as soon as they start. When you hit one, Focus offers 25 minutes of Entertainment mode: only your entertainment
sites and apps work, other pages switch to an "Entertainment mode" page and other apps are hidden. When it ends, tabs
go back to their pages and hidden apps reappear. The offer and in-session notice show today's Entertainment mode
sessions and minutes used.

<br clear="right" />

### Kid mode

https://stick.cafe/ is always blocked; opening it offers 31 minutes of Kid mode, once per day, where only stick.cafe
works. End it early from the menu bar (it still counts as today's use).

### Pomodoro

<img src="docs/screenshots/pomodoro.png" alt="Pomodoro task picker" width="320" align="right" />

**Start Pomodoro…** in the menu bar (or **⌥⌘P** from anywhere) opens on your ClickUp tasks due today and overdue. Pick one, or type a goal: Focus
searches the tasks assigned to you as you type and offers a new one (assigned to you, due today): **Create** just adds
it to ClickUp, **Create and start** also starts the pomodoro. The star on a task sets or clears its high priority in
ClickUp, and tasks are listed by priority. **+1** after a due date moves the task to tomorrow, and **↗** opens it in
the browser. **✓** marks the task complete in ClickUp and drops it from the list, and **↻** reloads the list from
ClickUp. `#hashtags` in a new task's goal become ClickUp tags (`Write notes #docs`). Links in
task names show as their domain with a dotted underline (hover for the full URL; click one in the picker to open it). You get 25 minutes of focus, then a 5-minute break; when the break
ends, the pomodoro window opens again so you can start the next one. It also opens the first time
you use the Mac after sleep hours end, to start the day with a pomodoro. A small always-on-top window shows the time left and, when it ends, a summary with **Mark task complete**. If you save a
DeepSeek API key in Settings, the summary also shows a **focus review**: while you focused, Focus recorded which
apps and pages you kept in front; the timeline went to DeepSeek together with the task's name, tags and
description, and comes back as a focus level (1–10) and a one-sentence note. The record of what you did lives in
memory only and disappears once the review is in. Every pomodoro of the last 90 days — task, start and end,
focused minutes, whether it finished, and its focus level and note — is kept in `pomodoros.json`.

<img src="docs/screenshots/timer.png" alt="Pomodoro timer" width="300" />
<img src="docs/screenshots/timer-summary.png" alt="Pomodoro summary" width="300" />

<br clear="right" />

### Meeting mode

<img src="docs/screenshots/reminder.png" alt="Meeting reminder" width="300" align="right" />

Turns on by itself while a Zoom meeting runs or a Google Meet room is open in a browser. Spend a minute in another app
or tab and a small reminder asks you to go back. While you're on the meeting but not full screen, the same corner
suggests going full screen: press ⌃⌘F for Meet or ⇧⌘F for Zoom, or click **Go full screen** (needs Accessibility
permission, which macOS asks for the first time). Close it to skip it for that meeting. Presenting? Tick
**Presenting (pause reminders)** in the menu bar.

<br clear="right" />

While a mode, pomodoro or sleep-hours unlock is active, the menu bar shows a countdown next to the icon.

### Today's report

<img src="docs/screenshots/report.png" alt="Today's report" width="300" align="right" />

**Today's Report…** in the menu bar shows how today went: time active at the Mac, pomodoro focus (count, stopped
ones, average focus level and tasks), breaks, meetings, Entertainment and Kid mode, sleep-hours unlocks, and time
active outside every mode. Time outside a mode counts only while you use the Mac; time asleep or locked isn't
counted. It starts from zero each day.

<br clear="right" />

## Install

Focus is macOS only. Download the `.dmg` for your Mac from the
[latest release](https://github.com/rosinghal/focus/releases/latest): `arm64` for Apple silicon, `x64` for Intel.
Open it and drag Focus to Applications.

The app isn't signed or notarised, so macOS blocks it the first time. Open it once, then go to System Settings ›
Privacy & Security and click **Open Anyway**. If macOS says the app is damaged, clear the download flag:

```sh
xattr -dr com.apple.quarantine /Applications/Focus.app
```

It starts at login once installed.

### Build from source

```sh
git clone https://github.com/rosinghal/focus.git
cd focus
npm install
npm run install:local   # builds Focus.app, copies it to /Applications and launches it
```

`npm run dist` builds a `.dmg` in `dist/` instead.

## Setup

On first launch Settings opens on the **Passcode** tab. Blocking starts once a passcode is saved.

<p>
  <img src="docs/screenshots/settings.png" alt="Settings, Modes tab" width="360" />
  <img src="docs/screenshots/settings-passcode.png" alt="Settings, Passcode tab" width="360" />
</p>

1. **Passcode** — for real accountability, let someone else set it.
2. **WhatsApp** (optional, but without it nothing unlocks once the passcode is used) — enter the number of the person
   who should get unlock codes, including the country code, and save. Then click **Link WhatsApp** and scan the QR code
   from WhatsApp › Settings › Linked Devices on your own phone. Codes are sent from your account and deleted on your
   side, so only the recipient can read them.
3. **Schedule** — sleep hours.
4. **Modes** — entertainment sites and apps, a ClickUp personal API token (`pk_…`), workspace and list for
   Pomodoro (an ID or a link copied from ClickUp), and an optional DeepSeek API key for pomodoro
   focus reviews (platform.deepseek.com).
5. macOS asks once per browser to let Focus control it. Allow it, or that browser isn't covered.

Saving anything that only tightens blocking needs nothing. Loosening it — shorter sleep hours, unblocked sites or apps,
a new passcode or a new WhatsApp recipient — lists the changes and needs a WhatsApp code; the passcode works instead
only while WhatsApp isn't set up. Unlinking WhatsApp needs a code too.

## Privacy

Everything stays on your Mac, in `~/Library/Application Support/Focus`: settings, the scrypt-hashed passcode, the
focus log, the pomodoro history and the WhatsApp session. The ClickUp and DeepSeek tokens are stored there in plain text and only sent
to ClickUp and DeepSeek. WhatsApp codes are hashed and kept in memory only.

With a DeepSeek key saved, one summary of what you did during a pomodoro — the frontmost app and open browser
pages, nothing else on disk — is sent to DeepSeek with the task's name, tags and description so it can rate the
focus level; the level and its one-sentence note are the only things kept.

WhatsApp messages are sent with [Baileys](https://github.com/WhiskeySockets/Baileys), an unofficial WhatsApp Web
client, so WhatsApp could flag the account for automation.

## Limits

This is a self-control tool, not a security boundary. Killing the process from Terminal or Activity Monitor during an
unlock, changing the system clock, or using another user account will get around it. Firefox can't be scripted, so
block the Firefox app itself if needed.

## Development

```sh
npm install
npm start          # run in dev (locks the screen during sleep hours once a passcode is set)
npm test           # unit tests, once
```

Plain CommonJS, no build step. See [AGENTS.md](AGENTS.md) for the layout, conventions and behaviour that must hold, and
[CHANGELOG.md](CHANGELOG.md) for release history. To try it outside your own settings, launch with a throwaway
`--user-data-dir`. `FOCUS_WHATSAPP_DRY_RUN=1` prints WhatsApp codes instead of sending them.

## License

[MIT](LICENSE)
