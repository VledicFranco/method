/**
 * Proxy route — forwards /api/* to the backend server.
 * Strips the /api prefix and passes through to API_URL.
 * This keeps the backend URL server-side only, never exposed to the browser.
 */
import { type NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:47821';

async function proxy(req: NextRequest): Promise<NextResponse> {
  // Strip /api prefix from the path
  const path = req.nextUrl.pathname.replace(/^\/api/, '');
  const search = req.nextUrl.search;
  const url = `${API_URL}${path}${search}`;

  const body = req.method !== 'GET' && req.method !== 'HEAD'
    ? await req.text()
    : undefined;

  const upstream = await fetch(url, {
    method: req.method,
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  const data = await upstream.text();
  return new NextResponse(data, {
    status: upstream.status,
    headers: { 'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json' },
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const DELETE = proxy;
