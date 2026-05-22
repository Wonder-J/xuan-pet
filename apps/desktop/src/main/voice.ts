/**
 * Voice service sidecar management.
 * Spawns the Python voice_service process and communicates via HTTP.
 */
import { app } from 'electron';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { is } from '@electron-toolkit/utils';
import { ChildProcess, spawn } from 'child_process';

const VOICE_SERVICE_PORT = 17599;
const VOICE_SERVICE_URL = `http://127.0.0.1:${VOICE_SERVICE_PORT}`;

let voiceProcess: ChildProcess | null = null;
let isStarting = false;

function getVoiceServicePath(): string {
  if (is.dev) {
    // In dev mode, run the Python script directly
    return join(__dirname, '../../python/voice_service.py');
  }
  // In production, use the bundled binary
  const resourcesPath = process.resourcesPath || join(app.getAppPath(), '../');
  const platform = process.platform;
  const binaryName = platform === 'win32' ? 'voice_service.exe' : 'voice_service';
  return join(resourcesPath, 'python', binaryName);
}

function getVenvPython(): string {
  const venvDir = join(__dirname, '../../python/.venv');
  if (process.platform === 'win32') {
    return join(venvDir, 'Scripts', 'python.exe');
  }
  return join(venvDir, 'bin', 'python');
}

function getProjectVenv(): string {
  // Project-level venv (from workspace root)
  const projectVenv = join(__dirname, '../../../../.venv');
  if (process.platform === 'win32') {
    return join(projectVenv, 'Scripts', 'python.exe');
  }
  return join(projectVenv, 'bin', 'python');
}

import { execSync } from 'child_process';

/**
 * Ensure ~/.xuanshen/.venv exists with required packages.
 * Creates venv and installs deps on first run.
 * Returns the python path or null if setup failed.
 */
function ensureXuanshenVenv(): string | null {
  const home = app.getPath('home');
  const venvDir = join(home, '.xuanshen', '.venv');
  const venvPython = join(venvDir, 'bin', 'python');

  if (existsSync(venvPython)) {
    return venvPython;
  }

  console.log('[voice] Creating ~/.xuanshen/.venv ...');

  // Find a base python to create venv with
  const basePythonCandidates = [
    '/opt/homebrew/bin/python3',
    '/usr/local/bin/python3',
    join(home, '.pyenv', 'shims', 'python3'),
    '/usr/bin/python3',
  ];
  let basePython: string | null = null;
  for (const p of basePythonCandidates) {
    if (existsSync(p)) { basePython = p; break; }
  }
  if (!basePython) {
    console.error('[voice] No base python found to create venv');
    return null;
  }

  try {
    const xuanshenDir = join(home, '.xuanshen');
    if (!existsSync(xuanshenDir)) {
      mkdirSync(xuanshenDir, { recursive: true });
    }
    // Create venv
    execSync(`"${basePython}" -m venv "${venvDir}"`, { timeout: 30000 });
    // Install deps
    const reqFile = join(process.resourcesPath || join(app.getAppPath(), '../'), 'python', 'requirements.txt');
    if (existsSync(reqFile)) {
      console.log('[voice] Installing deps from:', reqFile);
      execSync(`"${venvPython}" -m pip install -r "${reqFile}" --quiet`, { timeout: 120000 });
    } else {
      // Fallback: install minimal deps directly
      console.log('[voice] Installing minimal voice deps...');
      execSync(`"${venvPython}" -m pip install edge-tts fastapi uvicorn soundfile --quiet`, { timeout: 120000 });
    }
    console.log('[voice] Venv setup complete:', venvDir);
    return venvPython;
  } catch (err) {
    console.error('[voice] Failed to create venv:', err);
    return null;
  }
}

export async function startVoiceService(): Promise<boolean> {
  if (voiceProcess || isStarting) return true;
  isStarting = true;

  try {
    const servicePath = getVoiceServicePath();

    // Check if service is already running on this port
    try {
      const res = await fetch(`${VOICE_SERVICE_URL}/health`);
      if (res.ok) {
        console.log('[voice] Service already running on port', VOICE_SERVICE_PORT);
        isStarting = false;
        return true;
      }
    } catch { /* not running, proceed to start */ }

    if (is.dev) {
      // Dev mode: prefer venv python, fallback to system python
      const venvPython = getVenvPython();
      const projectVenv = getProjectVenv();
      const pythonCmd = existsSync(venvPython)
        ? venvPython
        : existsSync(projectVenv)
          ? projectVenv
          : (process.platform === 'win32' ? 'python' : 'python3');
      console.log('[voice] Using python:', pythonCmd);
      voiceProcess = spawn(pythonCmd, [
        servicePath,
        '--port', String(VOICE_SERVICE_PORT),
        '--parent-pid', String(process.pid),
      ], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      });
    } else {
      // Production: try bundled binary first, then fallback to system python
      if (existsSync(servicePath)) {
        voiceProcess = spawn(servicePath, [
          '--port', String(VOICE_SERVICE_PORT),
          '--parent-pid', String(process.pid),
        ], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } else {
        // No bundled binary — try system python with the script from resources
        const resourcesPath = process.resourcesPath || join(app.getAppPath(), '../');
        const scriptPath = join(resourcesPath, 'python', 'voice_service.py');
        // Also try the original source location (if app is run from build dir near source)
        const devScript = join(app.getAppPath(), '..', '..', 'python', 'voice_service.py');
        const script = existsSync(scriptPath) ? scriptPath : existsSync(devScript) ? devScript : null;

        if (!script) {
          console.error('[voice] No voice service binary or script found');
          console.error('[voice] Tried:', servicePath, scriptPath, devScript);
          isStarting = false;
          return false;
        }

        // Ensure ~/.xuanshen/.venv exists with deps (auto-creates on first run)
        const pythonCmd = ensureXuanshenVenv();
        if (!pythonCmd) {
          console.error('[voice] Failed to setup Python environment');
          isStarting = false;
          return false;
        }

        console.log('[voice] Production fallback: using python:', pythonCmd, 'script:', script);
        // Augment PATH so subprocess can find its own deps
        const augmentedPath = [
          '/opt/homebrew/bin',
          '/usr/local/bin',
          join(app.getPath('home'), '.pyenv', 'shims'),
          process.env.PATH || '/usr/bin:/bin',
        ].join(':');

        voiceProcess = spawn(pythonCmd, [
          script,
          '--port', String(VOICE_SERVICE_PORT),
          '--parent-pid', String(process.pid),
        ], {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, PATH: augmentedPath },
        });
      }
    }

    voiceProcess.stdout?.on('data', (data) => {
      console.log('[voice]', data.toString().trim());
    });
    voiceProcess.stderr?.on('data', (data) => {
      console.error('[voice]', data.toString().trim());
    });
    voiceProcess.on('exit', (code) => {
      console.log('[voice] process exited with code', code);
      voiceProcess = null;
    });

    // Wait for the service to become healthy
    const healthy = await waitForHealth(15000);
    isStarting = false;
    return healthy;
  } catch (err) {
    console.error('[voice] Failed to start:', err);
    isStarting = false;
    return false;
  }
}

export function stopVoiceService(): void {
  if (voiceProcess) {
    voiceProcess.kill();
    voiceProcess = null;
  }
}

async function waitForHealth(timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${VOICE_SERVICE_URL}/health`);
      if (res.ok) return true;
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

export async function voiceGetModels(): Promise<any> {
  const res = await fetch(`${VOICE_SERVICE_URL}/models`);
  if (!res.ok) throw new Error(`Failed to get models: ${res.statusText}`);
  return res.json();
}

export async function voiceDownloadModel(modelId: string): Promise<any> {
  const res = await fetch(`${VOICE_SERVICE_URL}/models/${modelId}/download`, { method: 'POST' });
  if (!res.ok) throw new Error(`Failed to download model: ${res.statusText}`);
  return res.json();
}

export async function voiceSelectModel(modelId: string): Promise<any> {
  const res = await fetch(`${VOICE_SERVICE_URL}/models/${modelId}/select`, { method: 'POST' });
  if (!res.ok) throw new Error(`Failed to select model: ${res.statusText}`);
  return res.json();
}

export async function voiceGetVoices(): Promise<any> {
  const res = await fetch(`${VOICE_SERVICE_URL}/voices`);
  if (!res.ok) throw new Error(`Failed to get voices: ${res.statusText}`);
  return res.json();
}

export async function voiceUploadSample(filePath: string): Promise<any> {
  const fs = await import('fs');
  const path = await import('path');
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);

  const formData = new FormData();
  formData.append('file', new Blob([fileBuffer]), fileName);

  const res = await fetch(`${VOICE_SERVICE_URL}/voices/upload`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) throw new Error(`Failed to upload voice: ${res.statusText}`);
  return res.json();
}

export async function voiceDeleteVoice(voiceId: string): Promise<any> {
  const res = await fetch(`${VOICE_SERVICE_URL}/voices/${encodeURIComponent(voiceId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`Failed to delete voice: ${res.statusText}`);
  return res.json();
}

export async function voiceSpeak(text: string, voiceId?: string, language: string = 'Chinese', engine?: string): Promise<Buffer> {
  const body: any = { text, language };
  if (voiceId) body.voice_id = voiceId;
  if (engine) body.engine = engine;

  const res = await fetch(`${VOICE_SERVICE_URL}/speak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`TTS failed: ${res.statusText}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export function isVoiceServiceRunning(): boolean {
  return voiceProcess !== null && !voiceProcess.killed;
}
