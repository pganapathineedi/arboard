import { NextRequest, NextResponse } from 'next/server'

export function requireApiKey(req: NextRequest): NextResponse | null {
  if (process.env.NODE_ENV === 'development') return null;
  const key = req.headers.get('x-arboard-key')
  const expected = process.env.ARBOARD_API_KEY
  if (!expected) return null // skip check if not configured
  if (key !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}
