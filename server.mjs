import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const PORT = Number(process.env.PORT ?? 4567);
const PERMISSION_MODE = process.env.PERMISSION_MODE ?? 'acceptEdits';
const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const SESSION_LIST_LIMIT = 40;
const HISTORY_LIMIT = 30;

function readJsonLines(content) {
  return content.split('\n').flatMap((line) => {
    try {
      return line ? [JSON.parse(line)] : [];
    } catch {
      return [];
    }
  });
}

function textOf(messageContent) {
  if (typeof messageContent === 'string') return messageContent;
  if (!Array.isArray(messageContent)) return '';
  return messageContent
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

const IDE_INJECTED_CONTEXT = /<(ide_opened_file|ide_selection|browser_instruction|system-reminder)>[\s\S]*?<\/\1>/g;
const BROWSER_SELECTION = /\s*<browser-selection>[\s\S]*<\/browser-selection>/;

function promptTextOf(messageContent) {
  return textOf(messageContent)
    .replace(IDE_INJECTED_CONTEXT, '')
    .replace(BROWSER_SELECTION, '\n📎 已附上網頁選取')
    .trim();
}

function isHumanPrompt(record) {
  if (record.type !== 'user' || record.isSidechain || record.isMeta) return false;
  const text = promptTextOf(record.message?.content);
  return text !== '' && (!text.startsWith('<') || text.startsWith('<pasted_content'));
}

async function listSessionFiles() {
  const projectDirs = await fs.readdir(PROJECTS_DIR);
  const files = [];
  for (const projectDir of projectDirs) {
    const entries = await fs.readdir(path.join(PROJECTS_DIR, projectDir)).catch(() => []);
    for (const entry of entries.filter((name) => name.endsWith('.jsonl'))) {
      const filePath = path.join(PROJECTS_DIR, projectDir, entry);
      const stat = await fs.stat(filePath);
      files.push({ filePath, sessionId: entry.replace('.jsonl', ''), updatedAt: stat.mtimeMs });
    }
  }
  return files.sort((a, b) => b.updatedAt - a.updatedAt);
}

async function findSessionFile(sessionId) {
  const files = await listSessionFiles();
  return files.find((file) => file.sessionId === sessionId);
}

async function listSessions() {
  const files = (await listSessionFiles()).slice(0, SESSION_LIST_LIMIT);
  const sessions = await Promise.all(
    files.map(async ({ filePath, sessionId, updatedAt }) => {
      const records = readJsonLines(await fs.readFile(filePath, 'utf8'));
      const prompts = records.filter(isHumanPrompt);
      if (prompts.length === 0) return null;
      const cwd = records.find((record) => record.cwd)?.cwd;
      const lastPrompt = promptTextOf(prompts.at(-1).message.content);
      return { sessionId, cwd, title: lastPrompt.slice(0, 60), updatedAt };
    }),
  );
  return sessions.filter(Boolean);
}

async function sessionHistory(sessionId) {
  const file = await findSessionFile(sessionId);
  if (!file) return [];
  const records = readJsonLines(await fs.readFile(file.filePath, 'utf8'));
  return records
    .filter((record) => !record.isSidechain && (isHumanPrompt(record) || record.type === 'assistant'))
    .map((record) => ({
      role: record.type,
      text: record.type === 'user' ? promptTextOf(record.message.content) : textOf(record.message?.content).trim(),
    }))
    .filter((message) => message.text)
    .slice(-HISTORY_LIMIT);
}

function buildUserContent({ text, context, screenshot }) {
  const content = [];
  if (screenshot) {
    const [, mediaType, data] = screenshot.match(/^data:(image\/\w+);base64,(.+)$/);
    content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data } });
  }
  const contextText = context ? `\n\n<browser-selection>\n${context}\n</browser-selection>` : '';
  content.push({ type: 'text', text: text + contextText });
  return content;
}

function describeToolUse(block) {
  const input = block.input ?? {};
  const detail = input.file_path ?? input.command ?? input.pattern ?? input.url ?? '';
  return `${block.name} ${String(detail).slice(0, 120)}`.trim();
}

function streamChat(request, response) {
  const { sessionId, cwd } = request;
  const args = [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--permission-mode', PERMISSION_MODE,
  ];
  if (sessionId) args.push('--resume', sessionId);

  const claude = spawn('claude', args, { cwd: cwd || os.homedir(), stdio: ['pipe', 'pipe', 'pipe'] });
  const send = (event) => response.write(JSON.stringify(event) + '\n');
  response.on('close', () => claude.kill());

  let buffered = '';
  claude.stdout.on('data', (chunk) => {
    buffered += chunk;
    const lines = buffered.split('\n');
    buffered = lines.pop();
    for (const record of readJsonLines(lines.join('\n'))) {
      if (record.type === 'system' && record.subtype === 'init') {
        send({ type: 'session', sessionId: record.session_id, cwd: record.cwd });
      } else if (record.type === 'stream_event' && !record.parent_tool_use_id) {
        const delta = record.event?.delta;
        if (delta?.type === 'text_delta') send({ type: 'text', text: delta.text });
      } else if (record.type === 'assistant' && !record.parent_tool_use_id) {
        for (const block of record.message.content.filter((block) => block.type === 'tool_use')) {
          send({ type: 'tool', text: describeToolUse(block) });
        }
      } else if (record.type === 'result') {
        send({ type: 'done', sessionId: record.session_id, isError: record.is_error, result: record.is_error ? record.result : undefined });
      }
    }
  });

  let stderr = '';
  claude.stderr.on('data', (chunk) => (stderr += chunk));
  claude.on('close', (code) => {
    if (code !== 0 && stderr) send({ type: 'error', text: stderr.slice(-2000) });
    response.end();
  });

  claude.stdin.end(
    JSON.stringify({ type: 'user', message: { role: 'user', content: buildUserContent(request) } }) + '\n',
  );
}

async function readBody(request) {
  let body = '';
  for await (const chunk of request) body += chunk;
  return JSON.parse(body);
}

const LOCAL_HOSTS = [`127.0.0.1:${PORT}`, `localhost:${PORT}`];

// Chrome omits Origin on extension GET requests that host_permissions cover, so absence is allowed;
// any web page reaching us sends its own Origin, and the Host check blocks DNS-rebinding pages.
function isFromExtension(request) {
  const origin = request.headers.origin;
  const fromLocalHost = LOCAL_HOSTS.includes(request.headers.host);
  return fromLocalHost && (origin === undefined || origin.startsWith('chrome-extension://'));
}

const server = http.createServer(async (request, response) => {
  if (!isFromExtension(request)) {
    response.writeHead(403).end('only the browser extension may call this server');
    return;
  }
  if (request.headers.origin) response.setHeader('Access-Control-Allow-Origin', request.headers.origin);
  response.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (request.method === 'OPTIONS') return response.writeHead(204).end();

  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const historyMatch = url.pathname.match(/^\/sessions\/([\w-]+)\/messages$/);
    if (request.method === 'GET' && url.pathname === '/sessions') {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(await listSessions()));
    } else if (request.method === 'GET' && historyMatch) {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(await sessionHistory(historyMatch[1])));
    } else if (request.method === 'POST' && url.pathname === '/chat') {
      response.writeHead(200, { 'content-type': 'application/x-ndjson' });
      streamChat(await readBody(request), response);
    } else {
      response.writeHead(404).end();
    }
  } catch (error) {
    response.writeHead(500).end(String(error));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`claude-web-bridge listening on http://127.0.0.1:${PORT} (permission mode: ${PERMISSION_MODE})`);
});
