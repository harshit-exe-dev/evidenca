# Evidenca

*Made by Harshit Bharti*

Anyone can generate an app in minutes now. So the question stopped being "what did you build" and became **"did you actually build it?"**

Evidenca answers that. It's a VS Code extension that records your coding sessions — the hours, the saves, the commits, the 2am bug fixes — and turns them into a short film. Your app, building itself on screen. Your commit messages as title cards. A final stamp: HUMAN-MADE.

When someone asks if your project is real, you don't explain. You play the film.

## How it works

1. **Start a session** — open the command palette (`Ctrl+Shift+P`) and run `Evidenca: Start session`. A clock appears in the status bar. That's it; go code.
2. **Code normally** — Evidenca logs active editing time, every save, and your git commits into `.evidenca/<project>/timeline.json`. Run the screenshot companion alongside it and it captures your screen every few minutes:
   ```
   python watcher/watch.py --dir <your-project>/.evidenca/<project-name>
   ```
3. **Stop and render** — run `Evidenca: Stop session`, then `Evidenca: Render film`. Out comes `evidenca-film.mp4`: a cinematic timelapse of your work, graded with film grain and a vignette, ending on the stamp.

## What counts as "active"

Time between your edits, as long as the gaps are under two minutes. Typing in bursts, pausing, reading docs, fixing the thing you just broke — that's the human rhythm, and the film keeps it. Staring at the screen for an hour doesn't count, and that's the point.

## Privacy

Evidenca never touches the network. There are no network calls in the extension — no telemetry, no analytics, no accounts. Your timeline and screenshots live in `.evidenca/` inside your own project folder. Delete that folder and everything is gone. Your code never leaves your machine.

## Install

**From the VS Code Marketplace:** search "Evidenca" in the Extensions panel and hit Install. (Publishing in progress.)

**From source:**
```
git clone https://github.com/harshit-exe-dev/evidenca
cd evidenca/extension
npm install && npm run compile
npx vsce package   # produces evidenca-0.1.0.vsix
```
Then in VS Code: Extensions → `···` → Install from VSIX.

The renderer needs `ffmpeg` on your PATH and a common TTF font (DejaVu ships with most systems). The screenshot companion needs Python and `pip install mss`.

## What's inside

```
extension/   the VS Code extension (TypeScript)
watcher/     screenshot companion (Python, mss)
renderer/    the film renderer (Node + ffmpeg)
SKILL.md     the Evidenca skill doc
```

## License

MIT — do what you want with it. If your film gets you the internship, tell me about it.
