'use client';

import { BlockBlobClient } from '@azure/storage-blob';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { WORKFLOWS } from '../lib/workflows';

function baseName(path) {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
  const parts = trimmed.split('/').filter(Boolean);
  return parts[parts.length - 1] || '';
}

function parentPrefix(prefix) {
  const trimmed = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  const parts = trimmed.split('/').filter(Boolean);
  parts.pop();
  return parts.length ? `${parts.join('/')}/` : '';
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (!minutes) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function canSelectWorkflowForFolder(folderPath) {
  const parts = String(folderPath || '')
    .split('/')
    .filter(Boolean);

  return parts.length === 4 && parts[1] === 'raw_reads';
}

const MAX_PARALLEL_UPLOADS = 3;

export default function Home() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [folderName, setFolderName] = useState('');
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [filesToUpload, setFilesToUpload] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadStats, setUploadStats] = useState([]);
  const [currentPrefix, setCurrentPrefix] = useState('');
  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [authState, setAuthState] = useState({ checking: true, user: null });
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [workflowModal, setWorkflowModal] = useState({ open: false, folderName: '', workflowId: 'none' });
  const [savingWorkflow, setSavingWorkflow] = useState(false);
  const [status, setStatus] = useState({ text: '', error: false });
  const [preview, setPreview] = useState({ open: false, name: '', content: '', meta: '', note: '' });
  const statusClasses = status.error
    ? 'mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700'
    : 'mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700';

  async function loadDirectory(prefix = '') {
    setStatus({ text: 'Loading...', error: false });
    try {
      const res = await fetch(`/api/blobs?prefix=${encodeURIComponent(prefix)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load directory');

      setCurrentPrefix(data.prefix || '');
      setFolders(data.folders || []);
      setFiles(data.files || []);
      setSearch('');
      setPreview({ open: false, name: '', content: '', meta: '', note: '' });
      setStatus({ text: `Showing ${data.count} items`, error: false });
    } catch (error) {
      setStatus({ text: error.message, error: true });
    }
  }

  async function openFile(filePath) {
    setStatus({ text: `Loading file: ${baseName(filePath)}...`, error: false });
    try {
      const res = await fetch(`/api/blob-content?name=${encodeURIComponent(filePath)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load file content');

      setPreview({
        open: true,
        name: data.name || filePath,
        content: data.preview || '',
        meta: `${data.contentType || ''} | ${formatSize(data.contentLength || 0)}`,
        note: data.message || ''
      });
      setStatus({ text: `Opened file: ${baseName(filePath)}`, error: false });
    } catch (error) {
      setStatus({ text: error.message, error: true });
    }
  }

  async function uploadSingleFile(file) {
    const fileId = file.name + file.size + file.lastModified;

    const uploadInfoResponse = await fetch('/api/upload-url', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fileName: file.name,
        prefix: currentPrefix
      })
    });
    const uploadInfo = await uploadInfoResponse.json();
    if (!uploadInfoResponse.ok) {
      throw new Error(uploadInfo.error || `Could not prepare upload for ${file.name}`);
    }

    const startedAt = Date.now();
    const blockBlobClient = new BlockBlobClient(uploadInfo.uploadUrl);

    await blockBlobClient.uploadBrowserData(file, {
      blobHTTPHeaders: {
        blobContentType: file.type || 'application/octet-stream'
      },
      blockSize: 8 * 1024 * 1024,
      concurrency: 4,
      onProgress: (event) => {
        const elapsedMs = Date.now() - startedAt;
        const loaded = event.loadedBytes || 0;
        const total = file.size || 0;
        const progress = total ? (loaded / total) * 100 : 0;
        const speed = elapsedMs > 0 ? loaded / (elapsedMs / 1000) : 0;

        setUploadStats((current) =>
          current.map((item) =>
            item.id === fileId
              ? { ...item, loaded, total, progress, speed, elapsedMs, status: 'uploading' }
              : item
          )
        );
      }
    });

    setUploadStats((current) =>
      current.map((item) =>
        item.id === fileId
          ? {
              ...item,
              loaded: item.total || file.size || item.loaded,
              progress: 100,
              elapsedMs: Date.now() - startedAt,
              status: 'done'
            }
          : item
      )
    );

    return uploadInfo;
  }

  async function uploadFiles() {
    if (!filesToUpload.length) {
      setStatus({ text: 'Please choose file(s) first', error: true });
      return;
    }

    setUploading(true);
    setStatus({ text: `Uploading ${filesToUpload.length} file(s)...`, error: false });
    setUploadStats(
      filesToUpload.map((file) => ({
        id: file.name + file.size + file.lastModified,
        name: file.name,
        loaded: 0,
        total: file.size || 0,
        progress: 0,
        speed: 0,
        elapsedMs: 0,
        status: 'queued'
      }))
    );

    try {
      const selectedFiles = [...filesToUpload];
      const results = [];
      for (let index = 0; index < selectedFiles.length; index += MAX_PARALLEL_UPLOADS) {
        const batch = selectedFiles.slice(index, index + MAX_PARALLEL_UPLOADS);
        const batchResults = await Promise.allSettled(batch.map((file) => uploadSingleFile(file)));
        results.push(...batchResults);
      }

      setFilesToUpload([]);
      const picker = document.getElementById('file-upload-picker');
      if (picker) picker.value = '';

      const failures = results.filter((result) => result.status === 'rejected');
      if (failures.length) {
        setUploadStats((current) =>
          current.map((item, index) =>
            results[index]?.status === 'rejected'
              ? { ...item, status: 'error' }
              : item
          )
        );
      }

      await loadDirectory(currentPrefix);
      if (failures.length) {
        setStatus({
          text: `${selectedFiles.length - failures.length} uploaded, ${failures.length} failed`,
          error: true
        });
      } else {
        setStatus({ text: `Uploaded ${selectedFiles.length} file(s)`, error: false });
      }
    } catch (error) {
      setStatus({ text: error.message, error: true });
    } finally {
      setUploading(false);
      setTimeout(() => {
        setUploadStats([]);
      }, 2500);
    }
  }

  async function createFolder() {
    const trimmedFolderName = folderName.trim();
    if (!trimmedFolderName) {
      setStatus({ text: 'Please enter a folder name', error: true });
      return;
    }

    setCreatingFolder(true);
    setStatus({ text: `Creating folder ${trimmedFolderName}...`, error: false });

    try {
      const res = await fetch('/api/blobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prefix: currentPrefix,
          folderName: trimmedFolderName
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create folder');

      setFolderName('');
      setShowFolderModal(false);
      await loadDirectory(currentPrefix);
      setStatus({ text: `Created folder: ${trimmedFolderName}`, error: false });
    } catch (error) {
      setStatus({ text: error.message, error: true });
    } finally {
      setCreatingFolder(false);
    }
  }

  async function saveWorkflowSelection() {
    if (!workflowModal.folderName) {
      return;
    }

    setSavingWorkflow(true);
    setStatus({ text: `Saving workflow for ${baseName(workflowModal.folderName)}...`, error: false });

    try {
      const res = await fetch('/api/blobs', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: workflowModal.folderName,
          workflowId: workflowModal.workflowId,
          targetType: 'folder'
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save workflow');

      setFolders((current) =>
        current.map((folder) =>
          folder.name === workflowModal.folderName
            ? {
                ...folder,
                workflowName: data.workflowName || '',
                selectedByUsername: data.selectedByUsername || ''
              }
            : folder
        )
      );
      setStatus({
        text:
          workflowModal.workflowId === 'none'
            ? `Cleared workflow for ${baseName(workflowModal.folderName)}`
            : `Saved workflow for ${baseName(workflowModal.folderName)}`,
        error: false
      });
      setWorkflowModal({ open: false, folderName: '', workflowId: 'none' });
    } catch (error) {
      setStatus({ text: error.message, error: true });
    } finally {
      setSavingWorkflow(false);
    }
  }

  const rows = useMemo(() => {
    const items = [
      ...folders.map((path) => ({
        kind: 'folder',
        fullPath: path.name,
        name: baseName(path.name),
        lastModified: '',
        blobType: '',
        size: '',
        workflowName: path.workflowName || '',
        selectedByUsername: path.selectedByUsername || ''
      })),
      ...files.map((file) => ({
        kind: 'file',
        fullPath: file.name,
        name: baseName(file.name),
        lastModified: file.lastModified ? new Date(file.lastModified).toLocaleString() : '',
        blobType: 'Block blob',
        size: formatSize(file.size || 0)
      }))
    ];

    const q = search.trim();
    if (!q) return items;

    return items.filter((item) => item.name.includes(q));
  }, [folders, files, search]);

  const breadcrumbs = useMemo(() => {
    const parts = currentPrefix.split('/').filter(Boolean);
    const crumbs = [{ label: 'Home', prefix: '' }];
    let built = '';
    for (const part of parts) {
      built += `${part}/`;
      crumbs.push({ label: part, prefix: built });
    }
    return crumbs;
  }, [currentPrefix]);

  useEffect(() => {
    let alive = true;

    fetch('/api/auth/session', { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Unauthorized');
        }
        if (!alive) return;
        setAuthState({ checking: false, user: data.user });
        loadDirectory('');
      })
      .catch(() => {
        if (!alive) return;
        setAuthState({ checking: false, user: null });
        router.push('/login');
      });

    return () => {
      alive = false;
    };
  }, [router]);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  if (authState.checking) {
    return (
      <main className="mx-auto mt-6 max-w-5xl px-4">
        <p className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-ink shadow-sm">
          Checking login...
        </p>
      </main>
    );
  }

  if (!authState.user) {
    return null;
  }

  return (
    <main className="mx-auto my-8 max-w-5xl px-4">
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="m-0 text-3xl font-semibold tracking-tight text-ink md:text-4xl">Container</h1>
          <p className="mt-1 text-sm text-mist">Manage folders, uploads, and workflows.</p>
        </div>
        <div className="relative flex items-center gap-2 text-sm">
          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white transition hover:bg-slate-800"
            onClick={() => setShowUserMenu((current) => !current)}
          >
            {authState.user.username.charAt(0).toUpperCase()}
          </button>
          {showUserMenu ? (
            <div className="absolute right-0 top-12 z-20 flex min-w-[170px] flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-lg">
              <div className="break-words text-sm font-semibold text-ink capitalize">{authState.user.username}</div>
              <button
                type="button"
                className="h-10 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800"
                onClick={logout}
              >
                Logout
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-1.5 text-sm">
        {breadcrumbs.map((crumb, idx) => (
          <button
            key={crumb.prefix || 'root'}
            className="rounded-xl px-2.5 py-1.5 font-medium text-slate-600 transition hover:bg-slate-100 hover:text-ink"
            onClick={() => loadDirectory(crumb.prefix)}
          >
            {crumb.label}
            {idx < breadcrumbs.length - 1 ? ' >' : ''}
          </button>
        ))}
      </div>

      <div className="mb-5 flex flex-wrap gap-3">
        <button
          className="flex min-h-20 min-w-[150px] flex-col items-center justify-center gap-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-medium text-ink transition hover:bg-slate-100"
          type="button"
          onClick={() => document.getElementById('file-upload-picker')?.click()}
        >
          <span className="text-3xl leading-none text-slate-700">+</span>
          <span className="text-sm">Upload</span>
        </button>
        <button
          className="flex min-h-20 min-w-[150px] flex-col items-center justify-center gap-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-medium text-ink transition hover:bg-slate-100"
          type="button"
          onClick={() => {
            setFolderName('');
            setShowFolderModal(true);
          }}
        >
          <span className="text-3xl leading-none text-slate-700">+</span>
          <span className="text-center text-sm">Add a directory</span>
        </button>
      </div>

      <input
        id="file-upload-picker"
        type="file"
        multiple
        hidden
        onChange={(e) => setFilesToUpload(Array.from(e.target.files || []))}
      />

      {filesToUpload.length ? (
        <div className="mb-4 flex min-h-[42px] items-center gap-3 max-md:flex-col max-md:items-stretch">
          <span className="flex min-h-[42px] flex-1 items-center rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-mist">
            {filesToUpload.length === 1 ? filesToUpload[0].name : `${filesToUpload.length} files selected`}
          </span>
          <button
            className="h-10 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            type="button"
            onClick={uploadFiles}
            disabled={uploading}
          >
            {uploading ? 'Uploading...' : `Upload ${filesToUpload.length}`}
          </button>
        </div>
      ) : null}

      {uploadStats.length ? (
        <div className="mb-3">
          {uploadStats.map((item) => (
            <div key={item.id} className="mb-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="mb-2 flex justify-between gap-3 text-sm">
                <span className="break-words font-semibold text-ink">{item.name}</span>
                <span
                  className={`capitalize ${
                    item.status === 'done' ? 'text-emerald-700' : item.status === 'error' ? 'text-red-600' : 'text-slate-500'
                  }`}
                >
                  {item.status}
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full bg-slate-900 transition-all"
                  style={{ width: `${Math.min(item.progress, 100)}%` }}
                />
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-mist">
                <span>{Math.round(item.progress)}%</span>
                <span>{formatSize(item.loaded)} / {formatSize(item.total)}</span>
                <span>{formatSize(item.speed)}/s</span>
                <span>{formatDuration(item.elapsedMs)}</span>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mb-4 flex items-center gap-3">
        <input
          className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-base text-ink outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search blobs by prefix (case-sensitive)"
        />
      </div>

      <p className="mb-3 text-sm text-mist">Showing {rows.length} item(s)</p>

      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-[0.08em] text-mist">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Last modified</th>
                <th className="px-4 py-3">Blob type</th>
                <th className="px-4 py-3">Size</th>
                <th className="px-4 py-3">Workflow</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {currentPrefix ? (
                <tr className="cursor-pointer transition hover:bg-slate-50" onClick={() => loadDirectory(parentPrefix(currentPrefix))}>
                  <td className="px-4 py-3 font-semibold text-brandDeep">[..]</td>
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3" />
                </tr>
              ) : null}

              {rows.map((row) => (
                <tr key={`${row.kind}-${row.fullPath}`} className="cursor-pointer transition hover:bg-slate-50">
                  <td
                    className="px-4 py-3 font-medium text-ink"
                    onClick={row.kind === 'folder' ? () => loadDirectory(row.fullPath) : () => openFile(row.fullPath)}
                  >
                    {row.kind === 'folder' ? `📁 ${row.name}` : row.name}
                  </td>
                  <td className="px-4 py-3 text-mist">{row.lastModified}</td>
                  <td className="px-4 py-3 text-mist">{row.blobType}</td>
                  <td className="px-4 py-3 text-mist">{row.size}</td>
                  <td className="px-4 py-3 text-mist">
                    {row.kind === 'folder' && canSelectWorkflowForFolder(row.fullPath)
                      ? row.workflowName
                        ? `${row.workflowName}${row.selectedByUsername ? ` (${row.selectedByUsername})` : ''}`
                        : 'Not selected'
                      : ''}
                  </td>
                  <td className="px-4 py-3">
                    {row.kind === 'folder' && canSelectWorkflowForFolder(row.fullPath) ? (
                      row.workflowName && authState.user?.userType !== 'admin' ? (
                        <span className="inline-flex items-center gap-1.5 rounded-xl bg-amber-50 px-3 py-1.5 text-sm font-semibold text-amber-700 border border-amber-200">
                          <span className="inline-block h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                          In Process
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-ink transition hover:bg-slate-50"
                          onClick={() =>
                            setWorkflowModal({
                              open: true,
                              folderName: row.fullPath,
                              workflowId: WORKFLOWS.find((workflow) => workflow.label === row.workflowName)?.id || 'none'
                            })
                          }
                        >
                          {row.workflowName ? 'Change workflow' : 'Select workflow'}
                        </button>
                      )
                    ) : (
                      ''
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {preview.open ? (
        <section className="mt-5 overflow-hidden rounded-3xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
            <div>
              <strong>{baseName(preview.name)}</strong>
              <div className="mt-1 text-xs text-mist">{preview.meta}</div>
            </div>
            <button
              className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-ink transition hover:bg-slate-50"
              onClick={() => setPreview({ open: false, name: '', content: '', meta: '', note: '' })}
            >
              Close
            </button>
          </div>
          {preview.note ? <p className="mx-4 my-3 text-sm text-mist">{preview.note}</p> : null}
          <pre className="m-0 max-h-[420px] overflow-auto border-t border-slate-200 bg-slate-50 p-4 text-xs leading-6 text-slate-700">
            {preview.content}
          </pre>
        </section>
      ) : null}

      {showFolderModal ? (
        <div className="fixed inset-0 flex items-center justify-center bg-slate-950/40 p-4" onClick={() => !creatingFolder && setShowFolderModal(false)}>
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="m-0 text-2xl font-bold text-ink">Add a directory</h2>
            <p className="mb-4 mt-2 text-sm text-mist">Enter the name for the new folder in the current location.</p>
            <input
              className="mb-4 h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-base outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              autoFocus
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="Folder name"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && folderName.trim() && !creatingFolder) {
                  createFolder();
                }
                if (e.key === 'Escape' && !creatingFolder) {
                  setShowFolderModal(false);
                }
              }}
            />
            <div className="flex justify-end gap-3">
              <button
                type="button"
                className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                onClick={() => setShowFolderModal(false)}
                disabled={creatingFolder}
              >
                Cancel
              </button>
              <button
                type="button"
                className="h-10 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={createFolder}
                disabled={!folderName.trim() || creatingFolder}
              >
                {creatingFolder ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {workflowModal.open ? (
        <div className="fixed inset-0 flex items-center justify-center bg-slate-950/40 p-4" onClick={() => !savingWorkflow && setWorkflowModal({ open: false, folderName: '', workflowId: 'none' })}>
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="m-0 text-2xl font-bold text-ink">Select workflow</h2>
            <p className="mb-4 mt-2 text-sm text-mist">{baseName(workflowModal.folderName)}</p>
            <select
              className="mb-4 h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-base outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              value={workflowModal.workflowId}
              onChange={(e) => setWorkflowModal((current) => ({ ...current, workflowId: e.target.value }))}
            >
              {WORKFLOWS.map((workflow) => (
                <option key={workflow.id} value={workflow.id}>
                  {workflow.label}
                </option>
              ))}
            </select>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                onClick={() => setWorkflowModal({ open: false, folderName: '', workflowId: 'none' })}
                disabled={savingWorkflow}
              >
                Cancel
              </button>
              <button
                type="button"
                className="h-10 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={saveWorkflowSelection}
                disabled={savingWorkflow}
              >
                {savingWorkflow ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <p className={statusClasses}>{status.text}</p>
      </div>
    </main>
  );
}
