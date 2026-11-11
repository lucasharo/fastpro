import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import sharp from 'sharp';
import { getPool } from './db';
import { state } from './state';

function rssMb(): number {
  return Math.round(process.memoryUsage().rss / 1048576);
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

@Controller()
export class SpikeController {
  @Get('health')
  health() {
    return {
      ok: true,
      instanceId: state.instanceId,
      bootMs: state.bootMs,
      uptimeS: Math.round(process.uptime()),
      rssMb: rssMb(),
    };
  }

  @Get('v1/ping-db')
  async pingDb() {
    const pool = getPool();
    if (!pool) throw new ServiceUnavailableException({ ok: false, reason: 'db_not_configured' });
    const r = await pool.query('SELECT 1 AS ok');
    return { ok: r.rows[0]?.ok === 1 };
  }

  @Get('v1/ping-db-claims')
  async pingDbClaims() {
    const pool = getPool();
    if (!pool) throw new ServiceUnavailableException({ ok: false, reason: 'db_not_configured' });
    const sent = randomUUID().replace(/-/g, '');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Valor gerado aqui (hex), sem entrada do usuario; consulta simples.
      await client.query(`SELECT set_config('app.s09', '${sent}', true)`);
      const r = await client.query("SELECT current_setting('app.s09') AS v");
      await client.query('COMMIT');
      return { match: r.rows[0]?.v === sent };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  @Post('v1/echo')
  @HttpCode(200)
  echo(@Body() body: unknown) {
    return { bytes: JSON.stringify(body ?? null).length };
  }

  @Get('v1/sleep')
  async sleep(@Query('s') s?: string) {
    const sec = Math.min(Math.max(Number(s) || 0, 0), 400);
    await new Promise((resolve) => setTimeout(resolve, sec * 1000));
    return { slept: sec };
  }

  @Post('internal/jobs/tick')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  tick(@Headers('x-jobs-secret') provided?: string) {
    const expected = process.env.JOBS_TICK_SECRET ?? '';
    if (!provided || !expected || !safeEqual(provided, expected)) {
      throw new UnauthorizedException();
    }
    return undefined;
  }

  @Post('v1/webhook-probe')
  @HttpCode(200)
  webhookProbe(@Req() req: Request) {
    const info = {
      ev: 'webhook-probe',
      hasSignatureHeader: 'x-signature' in req.headers,
      hasRequestIdHeader: 'x-request-id' in req.headers,
      bytes: Number(req.headers['content-length'] ?? 0),
      at: new Date().toISOString(),
    };
    console.log(JSON.stringify(info));
    return { received: true, hasSignatureHeader: info.hasSignatureHeader, hasRequestIdHeader: info.hasRequestIdHeader };
  }

  @Post('v1/image-probe')
  @HttpCode(200)
  async imageProbe() {
    const t0 = performance.now();
    const src = await sharp({
      create: {
        width: 800,
        height: 800,
        channels: 3,
        background: { r: 128, g: 128, b: 128 },
        noise: { type: 'gaussian', mean: 128, sigma: 40 },
      },
    })
      .png()
      .toBuffer();
    const out = await sharp(src).resize(300, 300).webp().toBuffer();
    return {
      srcBytes: src.length,
      outBytes: out.length,
      ms: Math.round(performance.now() - t0),
      rssMb: rssMb(),
    };
  }
}
