import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { createWsServer, sendWsPayload } from '../server/ws.js';

test('a socket transport error is contained and releases the authentication timer', () => {
  const server = createServer();
  const wss = createWsServer(server);
  const socket = new EventEmitter() as EventEmitter & { readyState: number; terminate: () => void };
  socket.readyState = WebSocket.OPEN;
  let terminated = false;
  socket.terminate = () => { terminated = true; socket.emit('close'); };
  wss.emit('connection', socket);
  try {
    assert.doesNotThrow(() => socket.emit('error', new Error('Simulated transport failure')));
    assert.equal(terminated, true);
  } finally { socket.emit('close'); wss.close(); }
});

test('a slow browser is disconnected before another event is queued', () => {
  let sent = false; let terminated = false;
  const socket = { bufferedAmount: 1024 * 1024 + 1, send() { sent = true; }, terminate() { terminated = true; } };
  sendWsPayload(socket as unknown as WebSocket, '{}');
  assert.equal(sent, false);
  assert.equal(terminated, true);
});

test('send completion errors stay local to their socket', () => {
  let terminated = false;
  const socket = { bufferedAmount: 0, send(_payload: string, callback: (error: Error) => void) { callback(new Error('Transport closed')); }, terminate() { terminated = true; } };
  assert.doesNotThrow(() => sendWsPayload(socket as unknown as WebSocket, '{}'));
  assert.equal(terminated, true);
});

test('queue budget includes the UTF-8 bytes of the next event', () => {
  let sent = false; let terminated = false;
  const socket = { bufferedAmount: 1024 * 1024 - 2, send() { sent = true; }, terminate() { terminated = true; } };
  sendWsPayload(socket as unknown as WebSocket, 'áá');
  assert.equal(sent, false);
  assert.equal(terminated, true);
});
