import { NextResponse } from 'next/server';
import { getBlobAccessContext, isBlobPathAllowed } from '../../../lib/auth';
import { getContainerClient } from '../../../lib/azureBlob';

export async function POST(request) {
  try {
    const auth = await getBlobAccessContext(request);
    if (!auth.ok) return auth.response;

    const formData = await request.formData();
    const file = formData.get('file');
    const prefixRaw = (formData.get('prefix') || '').toString();
    const { isAdmin, allowedPrefixes } = auth;

    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const prefix = prefixRaw.replace(/^\/+|\/+$/g, '');
    const blobName = prefix ? `${prefix}/${file.name}` : file.name;

    if (!isAdmin && !isBlobPathAllowed(blobName, allowedPrefixes)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const containerClient = getContainerClient();
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    await blockBlobClient.uploadData(bytes, {
      blobHTTPHeaders: {
        blobContentType: file.type || 'application/octet-stream'
      }
    });

    return NextResponse.json({ message: 'Upload successful', blobName });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
