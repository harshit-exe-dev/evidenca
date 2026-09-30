import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// Evidenca — proof of human work.
// Everything here runs on the user's machine. There are no network calls,
// no telemetry, no analytics. The timeline is a local JSON file, nothing more.

interface TimelineEvent {
  t: number; // epoch ms
  type: 'session_start' | 'session_stop' | 'save' | 'commit' | 'note';
  file?: string;
  hash?: string;
  message?: string;
  detail?: string;
}

interface Timeline {
  project: string;
  author: string;
  createdAt: number;
  sessions: {
    startedAt: number;
    stoppedAt: number | null;
    activeSeconds: number;
    saves: number;
    commits: number;
  }[];
  events: TimelineEvent[];
}

interface Session {
  dir: string;
  timelinePath: string;
  timeline: Timeline;
  lastEdit: number;
  lastWrite: number;
  knownCommits: Set<string>;
  headAtStart: string | null;
}

let session: Session | null = null;
let statusBar: vscode.StatusBarItem;
let clockTimer: NodeJS.Timeout | null = null;
let gitTimer: NodeJS.Timeout | null = null;

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_]/g, '-').slice(0, 60) || 'project';
}

function sessionDir(): { root: string; dir: string; project: string } | null {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return null;
  }
  const project = sanitize(path.basename(folder.uri.fsPath));
  const dir = path.join(folder.uri.fsPath, '.evidenca', project);
  return { root: folder.uri.fsPath, dir, project };
}

function loadOrCreateTimeline(dir: string, project: string): { path: string; timeline: Timeline } {
  const timelinePath = path.join(dir, 'timeline.json');
  fs.mkdirSync(path.join(dir, 'frames'), { recursive: true });
  if (fs.existsSync(timelinePath)) {
    try {
      const raw = fs.readFileSync(timelinePath, 'utf8');
      const parsed = JSON.parse(raw) as Timeline;
      if (parsed && Array.isArray(parsed.events) && Array.isArray(parsed.sessions)) {
        return { path: timelinePath, timeline: parsed };
      }
    } catch {
      // Corrupt file — back it up and start fresh rather than crashing.
      fs.copyFileSync(timelinePath, timelinePath + '.corrupt-' + Date.now());
    }
  }
  const fresh: Timeline = {
    project,
    author: 'Harshit Bharti',
    createdAt: Date.now(),
    sessions: [],
    events: [],
  };
  return { path: timelinePath, timeline: fresh };
}

function writeTimeline(s: Session) {
  try {
    fs.writeFileSync(s.timelinePath, JSON.stringify(s.timeline, null, 2), 'utf8');
    s.lastWrite = Date.now();
  } catch (err) {
    vscode.window.showErrorMessage('Evidenca could not write the timeline: ' + String(err));
  }
}

function pushEvent(s: Session, e: TimelineEvent) {
  s.timeline.events.push(e);
  // Don't hammer the disk on every keystroke-driven event; saves flush anyway.
  if (Date.now() - s.lastWrite > 15000) {
    writeTimeline(s);
  }
}

// --- Git -----------------------------------------------------------------
// Uses VS Code's built-in git extension API. Read-only: we only ever read
// commit history. If the API is unavailable, sessions simply record no commits.

interface GitApi {
  repositories: GitRepo[];
}
interface GitRepo {
  state: { HEAD?: { commit?: string } | undefined };
  log(options?: { maxEntries?: number }): Promise<GitCommit[]>;
}
interface GitCommit {
  hash: string;
  message: string;
}

function getGitRepo(): GitRepo | null {
  try {
    const ext = vscode.extensions.getExtension('vscode.git');
    const api = ext?.exports?.getAPI?.(1) as GitApi | undefined;
    const repo = api?.repositories?.[0];
    return repo ?? null;
  } catch {
    return null;
  }
}

async function pollCommits(s: Session) {
  const repo = getGitRepo();
  if (!repo) {
    return;
  }
  try {
    const commits = await repo.log({ maxEntries: 40 });
    for (const c of commits) {
      if (s.knownCommits.has(c.hash)) {
        continue;
      }
      s.knownCommits.add(c.hash);
      // Skip commits that already existed before this session started.
      if (s.headAtStart && c.hash === s.headAtStart) {
        continue;
      }
      pushEvent(s, {
        t: Date.now(),
        type: 'commit',
        hash: c.hash.slice(0, 7),
        message: c.message.split('\n')[0].slice(0, 120),
      });
      const cur = s.timeline.sessions[s.timeline.sessions.length - 1];
      if (cur) {
        cur.commits += 1;
      }
    }
  } catch {
    // Git flakiness must never break a recording session.
  }
}

// --- Commands -------------------------------------------------------------

async function startSession() {
  if (session) {
    vscode.window.showInformationMessage('Evidenca is already recording this session.');
    return;
  }
  const info = sessionDir();
  if (!info) {
    vscode.window.showErrorMessage('Evidenca needs an open folder to record into.');
    return;
  }
  const { path: timelinePath, timeline } = loadOrCreateTimeline(info.dir, info.project);
  const repo = getGitRepo();
  const headAtStart = repo?.state?.HEAD?.commit ?? null;

  const now = Date.now();
  const record = { startedAt: now, stoppedAt: null as number | null, activeSeconds: 0, saves: 0, commits: 0 };
  timeline.sessions.push(record);

  session = {
    dir: info.dir,
    timelinePath,
    timeline,
    lastEdit: 0,
    lastWrite: 0,
    knownCommits: new Set<string>(),
    headAtStart,
  };
  // Seed known commits so pre-existing history isn't logged as new.
  if (repo) {
    try {
      const existing = await repo.log({ maxEntries: 40 });
      for (const c of existing) {
        session.knownCommits.add(c.hash);
      }
    } catch {
      /* ignore */
    }
  }
  pushEvent(session, { t: now, type: 'session_start', detail: info.project });
  writeTimeline(session);

  statusBar.text = 'Evidenca ● recording';
  statusBar.tooltip = 'Evidenca is recording this coding session (local only)';
  statusBar.show();

  clockTimer = setInterval(() => {
    if (!session) {
      return;
    }
    const rec = session.timeline.sessions[session.timeline.sessions.length - 1];
    const elapsed = Math.floor((Date.now() - rec.startedAt) / 1000);
    const h = String(Math.floor(elapsed / 3600)).padStart(2, '0');
    const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
    const s = String(elapsed % 60).padStart(2, '0');
    statusBar.text = `Evidenca ● ${h}:${m}:${s}`;
  }, 1000);

  gitTimer = setInterval(() => {
    if (session) {
      void pollCommits(session);
    }
  }, 30000);
  void pollCommits(session);

  vscode.window.showInformationMessage(
    `Evidenca is recording. Everything stays on this machine — nothing is uploaded.`
  );
}

function stopSession() {
  if (!session) {
    vscode.window.showInformationMessage('Evidenca is not recording right now.');
    return;
  }
  const s = session;
  session = null;
  if (clockTimer) {
    clearInterval(clockTimer);
    clockTimer = null;
  }
  if (gitTimer) {
    clearInterval(gitTimer);
    gitTimer = null;
  }
  const now = Date.now();
  const rec = s.timeline.sessions[s.timeline.sessions.length - 1];
  rec.stoppedAt = now;
  pushEvent(s, { t: now, type: 'session_stop' });
  writeTimeline(s);

  statusBar.text = 'Evidenca ○ idle';
  statusBar.tooltip = 'Evidenca — start a session to record proof of work';

  const mins = Math.round(rec.activeSeconds / 60);
  vscode.window.showInformationMessage(
    `Evidenca stopped. Logged ${mins} active minutes, ${rec.saves} saves, ${rec.commits} commits — all in .evidenca/`
  );
}

// Quote a string for POSIX shells (single-quote style — safe for $, `, !).
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function renderFilm(context: vscode.ExtensionContext) {
  const info = sessionDir();
  if (!info) {
    vscode.window.showErrorMessage('Evidenca needs an open folder to render from.');
    return;
  }
  const timelinePath = path.join(info.dir, 'timeline.json');
  if (!fs.existsSync(timelinePath)) {
    vscode.window.showErrorMessage('No Evidenca timeline yet — start a session first.');
    return;
  }
  const renderer = path.join(context.extensionPath, '..', 'renderer', 'render.js');
  if (!fs.existsSync(renderer)) {
    vscode.window.showErrorMessage('Evidenca renderer not found next to the extension.');
    return;
  }
  const out = path.join(info.dir, 'evidenca-film.mp4');
  const cmd =
    `node ${shellQuote(renderer)} --timeline ${shellQuote(timelinePath)} ` +
    `--out ${shellQuote(out)}`;
  const term = vscode.window.createTerminal('Evidenca');
  term.show();
  term.sendText(cmd, true);
  vscode.window.showInformationMessage('Evidenca is rendering your film in the terminal…');
}

// --- Activation -----------------------------------------------------------

export function activate(context: vscode.ExtensionContext) {
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.text = 'Evidenca ○ idle';
  statusBar.tooltip = 'Evidenca — start a session to record proof of work';
  statusBar.command = 'evidenca.start';
  statusBar.show();
  context.subscriptions.push(statusBar);

  // Active-time tracking: time between edits under 2 minutes apart counts as
  // active coding. Bursts, pauses, scrolling docs — that's the human rhythm.
  const onChange = vscode.workspace.onDidChangeTextDocument(() => {
    if (!session) {
      return;
    }
    const now = Date.now();
    if (session.lastEdit > 0 && now - session.lastEdit < 120000) {
      const rec = session.timeline.sessions[session.timeline.sessions.length - 1];
      rec.activeSeconds += Math.min((now - session.lastEdit) / 1000, 120);
    }
    session.lastEdit = now;
  });

  const onSave = vscode.workspace.onDidSaveTextDocument((doc) => {
    if (!session) {
      return;
    }
    const rec = session.timeline.sessions[session.timeline.sessions.length - 1];
    rec.saves += 1;
    const rel = vscode.workspace.asRelativePath(doc.uri, false);
    pushEvent(session, { t: Date.now(), type: 'save', file: rel.slice(0, 160) });
    writeTimeline(session);
  });

  context.subscriptions.push(
    onChange,
    onSave,
    vscode.commands.registerCommand('evidenca.start', startSession),
    vscode.commands.registerCommand('evidenca.stop', stopSession),
    vscode.commands.registerCommand('evidenca.render', () => renderFilm(context))
  );
}

export function deactivate() {
  if (session) {
    try {
      const rec = session.timeline.sessions[session.timeline.sessions.length - 1];
      rec.stoppedAt = Date.now();
      pushEvent(session, { t: Date.now(), type: 'session_stop', detail: 'vscode closed' });
      writeTimeline(session);
    } catch {
      /* best effort on shutdown */
    }
    session = null;
  }
  if (clockTimer) {
    clearInterval(clockTimer);
  }
  if (gitTimer) {
    clearInterval(gitTimer);
  }
}
