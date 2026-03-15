import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';

/**
 * POST /api/queues/support-manager/voice-memo
 * Upload a voice memo for a ticket (vp_revops only)
 */
export async function POST(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_SUPPORT_MANAGER);
  if (authResult instanceof NextResponse) return authResult;
  const user = authResult;

  if (user.role !== 'vp_revops') {
    return NextResponse.json({ error: 'Only VP RevOps can record voice memos' }, { status: 403 });
  }

  try {
    const formData = await request.formData();
    const ticketId = formData.get('ticketId') as string;
    const audio = formData.get('audio') as File;
    const durationSeconds = formData.get('durationSeconds') as string;

    if (!ticketId || !audio) {
      return NextResponse.json({ error: 'ticketId and audio are required' }, { status: 400 });
    }

    const serviceClient = createServiceClient();
    const ext = audio.type.includes('mp4') ? 'mp4' : 'webm';
    const storagePath = `${ticketId}/${Date.now()}.${ext}`;

    // Upload audio to Supabase Storage
    const arrayBuffer = await audio.arrayBuffer();
    const { error: uploadError } = await serviceClient.storage
      .from('voice-memos')
      .upload(storagePath, arrayBuffer, {
        contentType: audio.type || 'audio/webm',
        upsert: false,
      });

    if (uploadError) {
      console.error('Voice memo upload error:', uploadError);
      return NextResponse.json({ error: 'Failed to upload audio', details: uploadError.message }, { status: 500 });
    }

    // Delete old memo file if replacing
    const { data: existing } = await serviceClient
      .from('ticket_voice_memos')
      .select('storage_path')
      .eq('hubspot_ticket_id', ticketId)
      .single();

    if (existing?.storage_path) {
      await serviceClient.storage.from('voice-memos').remove([existing.storage_path]);
    }

    // Upsert voice memo record
    const { data: memo, error: upsertError } = await serviceClient
      .from('ticket_voice_memos')
      .upsert(
        {
          hubspot_ticket_id: ticketId,
          recorded_by: user.id,
          storage_path: storagePath,
          duration_seconds: durationSeconds ? parseInt(durationSeconds, 10) : null,
          acknowledged_at: null,
          acknowledged_by: null,
          created_at: new Date().toISOString(),
        },
        { onConflict: 'hubspot_ticket_id' }
      )
      .select()
      .single();

    if (upsertError) {
      console.error('Voice memo upsert error:', upsertError);
      return NextResponse.json({ error: 'Failed to save voice memo', details: upsertError.message }, { status: 500 });
    }

    return NextResponse.json({ memo });
  } catch (error) {
    console.error('Voice memo error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/queues/support-manager/voice-memo
 * Acknowledge a voice memo
 */
export async function PATCH(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_SUPPORT_MANAGER);
  if (authResult instanceof NextResponse) return authResult;
  const user = authResult;

  try {
    const { ticketId } = await request.json();
    if (!ticketId) {
      return NextResponse.json({ error: 'ticketId is required' }, { status: 400 });
    }

    const serviceClient = createServiceClient();
    const { data: memo, error } = await serviceClient
      .from('ticket_voice_memos')
      .update({
        acknowledged_at: new Date().toISOString(),
        acknowledged_by: user.id,
      })
      .eq('hubspot_ticket_id', ticketId)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: 'Failed to acknowledge', details: error.message }, { status: 500 });
    }

    return NextResponse.json({ memo });
  } catch (error) {
    console.error('Voice memo acknowledge error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/queues/support-manager/voice-memo?ticketId=xxx
 * Get a signed URL for audio playback
 */
export async function GET(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_SUPPORT_MANAGER);
  if (authResult instanceof NextResponse) return authResult;

  const ticketId = request.nextUrl.searchParams.get('ticketId');
  if (!ticketId) {
    return NextResponse.json({ error: 'ticketId is required' }, { status: 400 });
  }

  try {
    const serviceClient = createServiceClient();
    const { data: memo } = await serviceClient
      .from('ticket_voice_memos')
      .select('storage_path')
      .eq('hubspot_ticket_id', ticketId)
      .single();

    if (!memo) {
      return NextResponse.json({ error: 'No voice memo found' }, { status: 404 });
    }

    const { data: signedUrl, error: signError } = await serviceClient.storage
      .from('voice-memos')
      .createSignedUrl(memo.storage_path, 3600);

    if (signError || !signedUrl) {
      return NextResponse.json({ error: 'Failed to generate playback URL' }, { status: 500 });
    }

    return NextResponse.json({ url: signedUrl.signedUrl });
  } catch (error) {
    console.error('Voice memo URL error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
