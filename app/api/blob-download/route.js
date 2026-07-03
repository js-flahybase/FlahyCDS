import { getBlobAccessContext, isBlobPathAllowed } from '../../../lib/auth';
import { getContainerClient } from '../../../lib/azureBlob';

export async function GET(request) {
  try {
    const auth = await getBlobAccessContext(request);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const name = searchParams.get('name');
    const { isAdmin, allowedPrefixes } = auth;

    if (!name) {
      return Response.json({ error: 'Missing file name' }, { status: 400 });
    }

    if (!isAdmin && !isBlobPathAllowed(name, allowedPrefixes)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const containerClient = getContainerClient();
    const blobClient = containerClient.getBlobClient(name);

    const props = await blobClient.getProperties();
    const contentType = props.contentType || 'application/octet-stream';
    const contentLength = props.contentLength || 0;

    const downloadResponse = await blobClient.download();
    const stream = downloadResponse.readableStreamBody;

    if (!stream) {
      return Response.json({ error: 'File stream unavailable' }, { status: 500 });
    }

    const fileName = name.split('/').pop();
    const encodedFileName = encodeURIComponent(fileName);

    return new Response(stream, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(contentLength),
        'Content-Disposition': `attachment; filename="${fileName}"; filename*=UTF-8''${encodedFileName}`
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
