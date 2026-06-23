import { NextResponse } from 'next/server';
import { getClientConfig, getClientAgentOverrides } from '@/lib/clients';

export async function GET() {
  if (!process.env.CLIENT_ID) {
    return NextResponse.json({ active: false });
  }
  try {
    const config = await getClientConfig();
    const overrides = await getClientAgentOverrides(config.clientId);
    return NextResponse.json({
      active: true,
      ...config,
      overrideCount: overrides.length,
    });
  } catch (err) {
    return NextResponse.json(
      { active: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
