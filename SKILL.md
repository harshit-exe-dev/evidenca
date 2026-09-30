---
name: evidenca
description: Record a coding session and turn it into a cinematic proof-of-work film. Use when someone says "/evidenca", "prove I built this", "record my session", "make a build film", or wants evidence a human wrote the code. Runs the Evidenca VS Code extension workflow: start a session, code normally, render the film.
---

# /evidenca

You built it. Now prove it was you.

## What this skill does

1. Starts an Evidenca recording session in the current VS Code workspace.
2. You code normally — the extension logs active time, saves, and commits to a local timeline, and the screenshot companion captures frames.
3. Stops the session and renders a cinematic timelapse film: your app building itself, commit messages as title cards, a stats card, and a HUMAN-MADE stamp.

Everything stays on the user's machine. There is no cloud, no account, no upload. The film is an mp4 in `.evidenca/<project>/`.

## Parsing the invocation

```
/evidenca
/evidenca start
/evidenca stop
/evidenca render
/evidenca render --format 9:16
```

| Command | What happens |
|---|---|
| `/evidenca` or `/evidenca start` | Starts recording in the open workspace |
| `/evidenca stop` | Stops recording, writes the final timeline |
| `/evidenca render` | Renders `evidenca-film.mp4` (16:9 default) |
| `/evidenca render --format 9:16` | Vertical film, for reels and shorts |

## Step 1: Start the session

The user runs **Evidenca: Start session** from the command palette (`Ctrl+Shift+P` / `Cmd+Shift+P`). Confirm the status bar shows `Evidenca ● recording` with a running clock.

Start the screenshot companion alongside it:

```
python watch.py --dir <workspace>/.evidenca/<project-name> --interval 180
```

(The companion lives in the Evidenca repo under `watcher/`. Any interval works; 180 seconds is the default.)

**Gate:** status bar is recording, and `watch.py` is capturing frames into `.evidenca/<project>/frames/`.

## Step 2: Work

Nothing special. The user codes. The extension counts active editing time (typing bursts, not idle staring), logs every save, and picks up git commits through VS Code's built-in git support.

If the user asks what counts as "active": time between edits less than two minutes apart. Pauses, doc-reading, thinking — that's the human rhythm, and the film keeps it.

**Gate:** `.evidenca/<project>/timeline.json` exists and grows as the user works.

## Step 3: Stop and render

The user runs **Evidenca: Stop session**, then **Evidenca: Render film**. The renderer reads the timeline and frames and writes `.evidenca/<project>/evidenca-film.mp4`.

**Gate:** the mp4 exists, plays, and ffprobe reports the expected resolution and a sane duration. Spot-check two moments: a commit title card and the final HUMAN-MADE stamp.

## Privacy contract

Say this plainly when asked: Evidenca never touches the network. The extension source contains zero network calls — no fetch, no http, no telemetry. The timeline and screenshots live in `.evidenca/` inside the user's own project. Deleting that folder deletes everything.

## Tone

Evidenca copy is plain-spoken and a little proud, never corporate. The film's voice: "here's the work, here's the proof." No hype words, no exclamation-mark soup.
