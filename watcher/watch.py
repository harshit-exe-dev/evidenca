#!/usr/bin/env python3
"""
Evidenca screenshot companion (watch.py).

Sits quietly alongside the Evidenca VS Code extension and captures a
screenshot every few minutes into the session's frames/ directory, so the
film renderer has real visuals of the work happening.

Everything stays on this machine. No network, no uploads, no telemetry.

Usage:
    python watch.py --dir /path/to/project/.evidenca/my-project [--interval 180]

Requires: pip install mss
"""

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Evidenca screenshot companion")
    p.add_argument(
        "--dir",
        required=True,
        help="Session directory, e.g. /path/to/project/.evidenca/my-project",
    )
    p.add_argument(
        "--interval",
        type=int,
        default=180,
        help="Seconds between screenshots (default: 180)",
    )
    p.add_argument(
        "--max-frames",
        type=int,
        default=2000,
        help="Stop after this many frames (default: 2000)",
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()
    session_dir = Path(args.dir).expanduser().resolve()
    frames_dir = session_dir / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)
    index_path = frames_dir / "index.json"

    try:
        import mss
        import mss.tools
    except ImportError:
        print("Evidenca watcher needs the 'mss' package: pip install mss", file=sys.stderr)
        return 2

    if args.interval < 5:
        print("Evidenca watcher: interval too small, using 5s minimum", file=sys.stderr)
        args.interval = 5

    # Resume numbering where a previous run left off.
    existing = sorted(frames_dir.glob("frame-*.png"))
    counter = 0
    if existing:
        try:
            counter = max(int(f.stem.split("-")[1]) for f in existing)
        except (IndexError, ValueError):
            counter = len(existing)

    index: list = []
    if index_path.exists():
        try:
            index = json.loads(index_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            index = []

    print(f"Evidenca watcher: saving a screenshot every {args.interval}s into {frames_dir}")
    print("Press Ctrl+C to stop.")

    try:
        with mss.mss() as sct:
            monitor = sct.monitors[1]  # primary monitor
            while counter < args.max_frames:
                counter += 1
                name = f"frame-{counter:06d}.png"
                out = frames_dir / name
                shot = sct.grab(monitor)
                mss.tools.to_png(shot.rgb, shot.size, output=str(out))
                index.append(
                    {
                        "file": name,
                        "t": datetime.now(timezone.utc).isoformat(),
                        "w": shot.width,
                        "h": shot.height,
                    }
                )
                try:
                    index_path.write_text(json.dumps(index, indent=2), encoding="utf-8")
                except OSError as exc:
                    print(f"Evidenca watcher: could not update index: {exc}", file=sys.stderr)
                print(f"[{datetime.now().strftime('%H:%M:%S')}] captured {name}")
                time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\nEvidenca watcher: stopped by user.")
    print(f"Evidenca watcher: {counter} frames total in {frames_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
