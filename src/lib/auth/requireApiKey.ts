import { NextRequest, NextResponse } from 'next/server'

export function requireApiKey(req: NextRequest): NextResponse | null {
  const key = req.headers.get('x-arboard-key')
  if (!process.env.ARBOARD_API_KEY) return null // skip check if not configured
  if (key !== process.env.ARBOARD_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}
