import { NextResponse } from 'next/server';
import { getBlobAccessContext, isBlobPathAllowed } from '../../../lib/auth';
import { createBlobUploadUrl } from '../../../lib/azureBlob';

function normalizePrefix(prefix) {
  return String(prefix || '').replace(/^\/+|\/+$/g, '');
}

export async function POST(request) {
  try {
    const auth = await getBlobAccessContext(request);
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const fileName = String(body?.fileName || '').trim();
    const prefix = normalizePrefix(body?.prefix);
    const { isAdmin, allowedPrefixes } = auth;

    if (!fileName) {
      return NextResponse.json({ error: 'File name is required' }, { status: 400 });
    }

    const blobName = prefix ? `${prefix}/${fileName}` : fileName;
    if (!isAdmin && !isBlobPathAllowed(blobName, allowedPrefixes)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const uploadUrl = createBlobUploadUrl(blobName);

    return NextResponse.json({ blobName, uploadUrl });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
