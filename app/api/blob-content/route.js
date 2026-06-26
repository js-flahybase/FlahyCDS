import { NextResponse } from 'next/server';
import { getBlobAccessContext, isBlobPathAllowed } from '../../../lib/auth';
import { getContainerClient } from '../../../lib/azureBlob';

const TEXT_TYPES = [
  'text/',
  'application/json',
  'application/xml',
  'application/csv',
  'application/javascript'
];

function isProbablyText(contentType = '', name = '') {
  const ct = contentType.toLowerCase();
  if (TEXT_TYPES.some((t) => ct.startsWith(t) || ct === t)) return true;
  return /(\.txt|\.csv|\.json|\.log|\.tsv|\.xml|\.md)$/i.test(name);
}

async function streamToText(readableStream) {
  const chunks = [];
  for await (const chunk of readableStream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

export async function GET(request) {
  try {
    const auth = await getBlobAccessContext(request);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const name = searchParams.get('name');
    const { isAdmin, allowedPrefixes } = auth;

    if (!name) {
      return NextResponse.json({ error: 'Missing file name' }, { status: 400 });
    }

    if (!isAdmin && !isBlobPathAllowed(name, allowedPrefixes)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const containerClient = getContainerClient();
    const blobClient = containerClient.getBlobClient(name);

    const props = await blobClient.getProperties();
    const contentType = props.contentType || 'application/octet-stream';
    const contentLength = props.contentLength || 0;
    const accessTier = props.accessTier || '';

    if (String(accessTier).toLowerCase() === 'archive') {
      return NextResponse.json(
        {
          name,
          contentType,
          contentLength,
          accessTier,
          preview: null,
          message:
            'This blob is in Archive tier and cannot be read directly. Rehydrate it to Hot or Cool tier, then try preview again.'
        },
        { status: 200 }
      );
    }

    if (!isProbablyText(contentType, name)) {
      return NextResponse.json(
        {
          name,
          contentType,
          contentLength,
          accessTier,
          preview: null,
          message: 'Preview is available only for text-like files. This file appears binary.'
        },
        { status: 200 }
      );
    }

    const downloadResponse = await blobClient.download();
    let text = '';

    if (downloadResponse.readableStreamBody) {
      text = await streamToText(downloadResponse.readableStreamBody);
    } else if (downloadResponse.blobBody) {
      const body = await downloadResponse.blobBody;
      text = await body.text();
    } else {
      throw new Error('File stream was empty or unavailable for preview.');
    }

    const maxChars = 200000;
    const clipped = text.length > maxChars;

    return NextResponse.json({
      name,
      contentType,
      contentLength,
      accessTier,
      preview: clipped ? text.slice(0, maxChars) : text,
      clipped,
      message: clipped ? `Showing first ${maxChars.toLocaleString()} characters.` : ''
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
