import { NextResponse } from 'next/server';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth/types';

export async function POST() {
  const authResult = await checkApiAuth(RESOURCES.MORNING_BRIEFING);
  if (authResult instanceof NextResponse) return authResult;

  const githubPat = process.env.GITHUB_PAT;
  const githubRepo = process.env.GITHUB_REPO;

  if (!githubPat || !githubRepo) {
    return NextResponse.json(
      { error: 'GITHUB_PAT and GITHUB_REPO must be configured' },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(
      `https://api.github.com/repos/${githubRepo}/actions/workflows/morning-briefing.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${githubPat}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: 'main' }),
      }
    );

    if (!res.ok) {
      const body = await res.text();
      return NextResponse.json(
        { error: `GitHub API error: ${res.status} ${body}` },
        { status: 502 }
      );
    }

    return NextResponse.json({ triggered: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
