import { NextResponse } from 'next/server';
import { canBrowsePrefix, getBlobAccessContext, isBlobPathAllowed, normalizeBlobPrefix } from '../../../lib/auth';
import { FOLDER_MARKER_NAME, getContainerClient, getContainerName } from '../../../lib/azureBlob';
import { query } from '../../../lib/db';
import { WORKFLOWS } from '../../../lib/workflows';

const FOLDER_REGISTRY_TABLE = 'blob_folders';

function normalizePrefix(prefix) {
  return normalizeBlobPrefix(prefix);
}

function canAssignWorkflowToFolder(folderPath) {
  const parts = String(folderPath || '')
    .split('/')
    .filter(Boolean);

  return parts.length === 4 && parts[1] === 'raw_reads';
}

async function ensureFolderRegistry() {
  await query(
    `create table if not exists ${FOLDER_REGISTRY_TABLE} (
       folder_path text primary key,
       created_by_user_id bigint,
       created_by_username text,
       created_at timestamptz not null default now()
     )`
  );
}

async function ensureFolderWorkflowsStatus() {
  await query(
    `alter table folder_workflows add column if not exists status text not null default 'processing'`
  );
}

function isDirectChildFolder(parentPrefix, folderPath) {
  const normalizedParent = normalizePrefix(parentPrefix);
  const normalizedFolder = normalizePrefix(folderPath);

  if (!normalizedFolder) return false;
  if (normalizedParent && !normalizedFolder.startsWith(normalizedParent)) return false;

  const remainder = normalizedParent
    ? normalizedFolder.slice(normalizedParent.length)
    : normalizedFolder;

  return remainder.split('/').filter(Boolean).length === 1;
}

async function listRegisteredFolders(prefix, { isAdmin, allowedPrefixes }) {
  await ensureFolderRegistry();

  const result = await query(
    `select folder_path
     from ${FOLDER_REGISTRY_TABLE}
     where folder_path like $1
     order by folder_path`,
    [`${prefix}%`]
  );

  return result.rows
    .map((row) => normalizePrefix(row.folder_path))
    .filter((folderPath) => isDirectChildFolder(prefix, folderPath))
    .filter((folderPath) => isAdmin || isBlobPathAllowed(folderPath, allowedPrefixes));
}

function filterFoldersBySearch(folders, prefix, folderSearch) {
  if (!folderSearch) return folders;

  return folders.filter((folderPath) => {
    const folderName = folderPath.slice(prefix.length).replace(/\/$/, '');
    return folderName.toLowerCase().includes(folderSearch);
  });
}

async function folderExists(containerClient, folderPrefix) {
  await ensureFolderRegistry();

  const folderResult = await query(
    `select 1
     from ${FOLDER_REGISTRY_TABLE}
     where folder_path = $1
     limit 1`,
    [folderPrefix]
  );

  if (folderResult.rows[0]) {
    return true;
  }

  for await (const item of containerClient.listBlobsFlat({ prefix: folderPrefix })) {
    return true;
  }

  return false;
}

export async function GET(request) {
  try {
    const auth = await getBlobAccessContext(request);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const prefix = normalizePrefix(searchParams.get('prefix') || '');
    const folderSearch = (searchParams.get('folderSearch') || '').trim().toLowerCase();
    const { isAdmin, allowedPrefixes } = auth;

    if (!isAdmin && !canBrowsePrefix(prefix, allowedPrefixes)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const containerClient = getContainerClient();

    if (folderSearch) {
      const registeredFolders = await listRegisteredFolders(prefix, { isAdmin, allowedPrefixes });
      const folderSet = new Set(filterFoldersBySearch(registeredFolders, prefix, folderSearch));
      for await (const item of containerClient.listBlobsByHierarchy('/', { prefix, includeMetadata: true })) {
        if (item.kind === 'prefix') {
          const folderName = item.name.slice(prefix.length).replace(/\/$/, '');
          if (
            folderName.toLowerCase().includes(folderSearch) &&
            (isAdmin || isBlobPathAllowed(item.name, allowedPrefixes))
          ) {
            folderSet.add(item.name);
          }
        }
      }

      const folders = Array.from(folderSet).sort((a, b) => a.localeCompare(b));
      const folderRows = await Promise.all(
        folders.map(async (folder) => {
          const workflow = await getFolderWorkflow(folder);
          return {
            name: folder,
            workflowName: workflow.workflowName,
            selectedByUsername: workflow.selectedByUsername,
            status: workflow.status
          };
        })
      );
      return NextResponse.json({
        container: getContainerName(),
        prefix,
        folderSearch,
        folders: folderRows,
        count: folderRows.length
      });
    }

    const folderSet = new Set(await listRegisteredFolders(prefix, { isAdmin, allowedPrefixes }));
    const files = [];

    for await (const item of containerClient.listBlobsByHierarchy('/', { prefix, includeMetadata: true })) {
      if (item.kind === 'prefix') {
        if (isAdmin || isBlobPathAllowed(item.name, allowedPrefixes)) {
          folderSet.add(item.name);
        }
      } else {
        if (item.name === `${prefix}${FOLDER_MARKER_NAME}`) {
          continue;
        }

        if (!isAdmin && !isBlobPathAllowed(item.name, allowedPrefixes)) {
          continue;
        }

        files.push({
          name: item.name,
          size: item.properties.contentLength || 0,
          contentType: item.properties.contentType || '',
          lastModified: item.properties.lastModified || null
        });
      }
    }

    const folders = Array.from(folderSet).sort((a, b) => a.localeCompare(b));
    files.sort((a, b) => a.name.localeCompare(b.name));

    const folderRows = await Promise.all(
      folders.map(async (folder) => {
        const workflow = await getFolderWorkflow(folder);
        return {
          name: folder,
          workflowName: workflow.workflowName,
          selectedByUsername: workflow.selectedByUsername,
          status: workflow.status
        };
      })
    );

    return NextResponse.json({
      container: getContainerName(),
      prefix,
      folders: folderRows,
      files,
      count: folderRows.length + files.length
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

function normalizeFolderName(folderName) {
  return String(folderName || '').trim().replace(/^\/+|\/+$/g, '');
}

async function getFolderWorkflow(folderPrefix) {
  await ensureFolderWorkflowsStatus();
  const result = await query(
    `select workflow_name, selected_by_username, status
     from folder_workflows
     where folder_path = $1
     limit 1`,
    [folderPrefix]
  );
  return {
    workflowName: result.rows[0]?.workflow_name || '',
    selectedByUsername: result.rows[0]?.selected_by_username || '',
    status: result.rows[0]?.status || ''
  };
}

export async function POST(request) {
  try {
    const auth = await getBlobAccessContext(request);
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const prefix = normalizePrefix(body?.prefix || '');
    const folderName = normalizeFolderName(body?.folderName);
    const { isAdmin, allowedPrefixes } = auth;

    if (!folderName) {
      return NextResponse.json({ error: 'Folder name is required' }, { status: 400 });
    }

    if (folderName.includes('/')) {
      return NextResponse.json({ error: 'Folder name cannot contain /' }, { status: 400 });
    }

    const folderPrefix = `${prefix}${folderName}/`;
    if (!isAdmin && !isBlobPathAllowed(folderPrefix, allowedPrefixes)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await ensureFolderRegistry();
    const containerClient = getContainerClient();
    const exists = await folderExists(containerClient, folderPrefix);
    if (exists) {
      return NextResponse.json({ error: 'Folder already exists' }, { status: 409 });
    }

    await query(
      `insert into ${FOLDER_REGISTRY_TABLE} (folder_path, created_by_user_id, created_by_username)
       values ($1, $2, $3)`,
      [folderPrefix, auth.session.userId, auth.session.username]
    );

    const markerClient = containerClient.getBlockBlobClient(`${folderPrefix}${FOLDER_MARKER_NAME}`);
    await markerClient.upload('', 0, { blobHTTPHeaders: { blobContentType: 'application/octet-stream' } });

    return NextResponse.json({
      message: 'Folder created',
      folder: folderPrefix
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const auth = await getBlobAccessContext(request);
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const name = body?.name;
    const { isAdmin, allowedPrefixes } = auth;

    if (!name) {
      return NextResponse.json({ error: 'Missing blob name in body' }, { status: 400 });
    }

    if (!isAdmin && !isBlobPathAllowed(String(name), allowedPrefixes)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const containerClient = getContainerClient();
    const blobClient = containerClient.getBlobClient(String(name));
    const result = await blobClient.deleteIfExists();

    return NextResponse.json({ deleted: result.succeeded, name: String(name) });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const auth = await getBlobAccessContext(request);
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const name = String(body?.name || '').trim();
    const action = String(body?.action || 'set-workflow').trim();
    const { isAdmin, allowedPrefixes, session } = auth;

    if (!name) {
      return NextResponse.json({ error: 'Missing blob name' }, { status: 400 });
    }

    if (!isAdmin && !isBlobPathAllowed(name, allowedPrefixes)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (action === 'set-status') {
      if (!isAdmin) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      const status = String(body?.status || '').trim();
      if (!['processing', 'complete'].includes(status)) {
        return NextResponse.json({ error: 'Invalid status. Use processing or complete' }, { status: 400 });
      }
      await ensureFolderWorkflowsStatus();
      await query(
        `update folder_workflows set status = $1 where folder_path = $2`,
        [status, normalizePrefix(name)]
      );
      return NextResponse.json({ ok: true, name, status });
    }

    const workflowId = String(body?.workflowId || '').trim();
    const targetType = String(body?.targetType || 'folder').trim();

    if (targetType === 'folder' && !canAssignWorkflowToFolder(name)) {
      return NextResponse.json({ error: 'Workflow can only be assigned to sample folders inside raw_reads batches' }, { status: 400 });
    }

    const isValidWorkflow = WORKFLOWS.some((workflow) => workflow.id === workflowId);
    if (!isValidWorkflow) {
      return NextResponse.json({ error: 'Invalid workflow selection' }, { status: 400 });
    }

    const workflowName = WORKFLOWS.find((workflow) => workflow.id === workflowId)?.label || '';

    if (workflowId === 'none') {
      await query('delete from folder_workflows where folder_path = $1', [normalizePrefix(name)]);
    } else {
      await ensureFolderWorkflowsStatus();
      await query(
        `insert into folder_workflows (folder_path, workflow_name, selected_by_user_id, selected_by_username, status)
         values ($1, $2, $3, $4, 'processing')
         on conflict (folder_path)
         do update set
           workflow_name = excluded.workflow_name,
           selected_by_user_id = excluded.selected_by_user_id,
           selected_by_username = excluded.selected_by_username,
           updated_at = now()`,
        [normalizePrefix(name), workflowName, session.userId, session.username]
      );
    }

    return NextResponse.json({ ok: true, name, workflowId, workflowName, selectedByUsername: session.username });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
