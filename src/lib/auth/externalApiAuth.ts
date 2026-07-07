import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'

let _supabase: SupabaseClient | null = null
function getSupabase(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _supabase
}

export interface ApiKeyRecord {
  client_id: string
  client_name: string
  tier: string
  daily_limit: number
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

export async function validateExternalApiKey(
  req: NextRequest
): Promise<{ record: ApiKeyRecord } | { error: NextResponse }> {
  const authHeader = req.headers.get('x-api-key')
  if (!authHeader) {
    return {
      error: NextResponse.json(
        { error: 'Missing x-api-key header' },
        { status: 401 }
      ),
    }
  }

  const keyHash = hashKey(authHeader)

  const { data, error } = await getSupabase()
    .from('api_keys')
    .select('client_id, client_name, tier, daily_limit, is_active')
    .eq('key_hash', keyHash)
    .single()

  if (error || !data) {
    return {
      error: NextResponse.json(
        { error: 'Invalid API key' },
        { status: 401 }
      ),
    }
  }

  if (!data.is_active) {
    return {
      error: NextResponse.json(
        { error: 'API key is inactive' },
        { status: 403 }
      ),
    }
  }

  // Update last_used_at (non-blocking)
  getSupabase()
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('key_hash', keyHash)
    .then(() => {})

  return { record: data as ApiKeyRecord }
}
