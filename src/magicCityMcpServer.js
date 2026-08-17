#!/usr/bin/env node
import process from 'node:process';
import { createMagicCityMcpRuntime, handleMagicCityMcpMessage } from './magicCityMcpCore.js';

const runtime = createMagicCityMcpRuntime({
  exposeAccountAuthTools: true
});

const inputBufferState = {
  buffer: Buffer.alloc(0)
};

process.stdin.on('data', (chunk) => {
  inputBufferState.buffer = Buffer.concat([inputBufferState.buffer, chunk]);
  processFrames().catch((error) => {
    writeStderr(`magic-city-mcp: frame processing failed: ${error.stack || error.message}`);
  });
});

process.stdin.on('end', () => process.exit(0));
process.stdin.resume();

async function processFrames() {
  while (true) {
    const headerEnd = inputBufferState.buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) return;
    const headerText = inputBufferState.buffer.slice(0, headerEnd).toString('utf8');
    const headers = parseHeaders(headerText);
    const length = Number(headers['content-length']);
    if (!Number.isFinite(length) || length < 0) throw new Error('invalid_content_length');
    const frameEnd = headerEnd + 4 + length;
    if (inputBufferState.buffer.length < frameEnd) return;
    const bodyText = inputBufferState.buffer.slice(headerEnd + 4, frameEnd).toString('utf8');
    inputBufferState.buffer = inputBufferState.buffer.slice(frameEnd);
    const message = safeJsonParse(bodyText);
    if (!message) {
      writeStderr('magic-city-mcp: ignoring unparsable JSON-RPC frame');
      continue;
    }
    const response = await handleMagicCityMcpMessage(runtime, message);
    if (response) writeMessage(response);
  }
}

function parseHeaders(text) {
  const result = {};
  for (const line of text.split('\r\n')) {
    const index = line.indexOf(':');
    if (index === -1) continue;
    const key = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();
    result[key] = value;
  }
  return result;
}

function writeMessage(message) {
  const body = JSON.stringify(message);
  const bytes = Buffer.byteLength(body, 'utf8');
  process.stdout.write(`Content-Length: ${bytes}\r\n\r\n${body}`);
}

function writeStderr(message) {
  process.stderr.write(`${message}\n`);
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
