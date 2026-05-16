/**
 * Voice service sidecar management.
 * Spawns the Python voice_service process and communicates via HTTP.
 */
import { app } from 'electron';
import { join } from 'path';
import { existsSync } from 'fs';
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
      const pythonCmd = existsSync(venvPython)
        ? venvPython
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
      // Production: run bundled binary
      if (!existsSync(servicePath)) {
        console.error('[voice] Binary not found:', servicePath);
        isStarting = false;
        return false;
      }
      voiceProcess = spawn(servicePath, [
        '--port', String(VOICE_SERVICE_PORT),
        '--parent-pid', String(process.pid),
      ], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
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

export async function voiceSpeak(text: string, voiceId?: string, language: string = 'Auto', engine?: string): Promise<Buffer> {
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
