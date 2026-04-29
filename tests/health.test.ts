import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app';

describe('GET /', () => {
  it('returns a welcome message', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.message).toBeDefined();
  });
});

describe('GET /health', () => {
  it('returns status ok with timestamp and uptime', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.timestamp).toBeDefined();
    expect(typeof res.body.uptime).toBe('number');
  });
});
