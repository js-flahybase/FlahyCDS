import {
  BlobSASPermissions,
  BlobServiceClient,
  generateBlobSASQueryParameters,
  StorageSharedKeyCredential
} from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';

export const FOLDER_MARKER_NAME = '.folder';

export function getContainerName() {
  const container = process.env.AZURE_STORAGE_CONTAINER;
  if (!container) {
    throw new Error('Missing AZURE_STORAGE_CONTAINER in environment');
  }
  return container;
}

function getBlobServiceClient() {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (connectionString) {
    return BlobServiceClient.fromConnectionString(connectionString);
  }

  const account = process.env.AZURE_STORAGE_ACCOUNT;
  const key = process.env.AZURE_STORAGE_ACCOUNT_KEY;

  if (!account || !key) {
    if (!account) {
      throw new Error('Missing Azure auth. Set AZURE_STORAGE_CONNECTION_STRING or AZURE_STORAGE_ACCOUNT + AZURE_STORAGE_ACCOUNT_KEY, or set AZURE_STORAGE_ACCOUNT and use az login.');
    }
    const credential = new DefaultAzureCredential();
    return new BlobServiceClient(`https://${account}.blob.core.windows.net`, credential);
  }

  const credential = new StorageSharedKeyCredential(account, key);
  return new BlobServiceClient(`https://${account}.blob.core.windows.net`, credential);
}

function parseConnectionStringValue(connectionString, key) {
  const part = connectionString
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.toLowerCase().startsWith(`${key.toLowerCase()}=`));

  return part ? part.slice(key.length + 1) : '';
}

export function getStorageAccountName() {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (connectionString) {
    const accountName = parseConnectionStringValue(connectionString, 'AccountName');
    if (accountName) return accountName;
  }

  const account = process.env.AZURE_STORAGE_ACCOUNT;
  if (!account) {
    throw new Error('Missing AZURE_STORAGE_ACCOUNT or AZURE_STORAGE_CONNECTION_STRING');
  }
  return account;
}

export function getStorageSharedKeyCredential() {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (connectionString) {
    const accountName = parseConnectionStringValue(connectionString, 'AccountName');
    const accountKey = parseConnectionStringValue(connectionString, 'AccountKey');
    if (accountName && accountKey) {
      return new StorageSharedKeyCredential(accountName, accountKey);
    }
  }

  const account = process.env.AZURE_STORAGE_ACCOUNT;
  const key = process.env.AZURE_STORAGE_ACCOUNT_KEY;
  if (account && key) {
    return new StorageSharedKeyCredential(account, key);
  }

  throw new Error('Direct browser uploads require AZURE_STORAGE_CONNECTION_STRING or AZURE_STORAGE_ACCOUNT + AZURE_STORAGE_ACCOUNT_KEY.');
}

export function createBlobUploadUrl(blobName, expiresInMinutes = 360) {
  const sharedKeyCredential = getStorageSharedKeyCredential();
  const accountName = getStorageAccountName();
  const containerName = getContainerName();
  const expiresOn = new Date(Date.now() + expiresInMinutes * 60 * 1000);

  const sas = generateBlobSASQueryParameters(
    {
      containerName,
      blobName,
      permissions: BlobSASPermissions.parse('cw'),
      expiresOn
    },
    sharedKeyCredential
  ).toString();

  return `https://${accountName}.blob.core.windows.net/${containerName}/${encodeURIComponent(blobName).replace(/%2F/g, '/')}` +
    `?${sas}`;
}

export function getContainerClient() {
  const serviceClient = getBlobServiceClient();
  return serviceClient.getContainerClient(getContainerName());
}
