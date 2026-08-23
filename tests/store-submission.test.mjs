import test from 'node:test';
import assert from 'node:assert/strict';
import {
  storeVersionFromTag,
  buildSubmissionUpdate,
  runStoreSubmission,
  selectStorePackages,
} from '../scripts/store-submission.mjs';

test('storeVersionFromTag accepts only vX.Y.Z-store tags and strips the trigger suffix', () => {
  assert.equal(storeVersionFromTag('v0.1.5-store'), '0.1.5');
  assert.throws(() => storeVersionFromTag('v0.1.5'), /must match vX.Y.Z-store/);
  assert.throws(() => storeVersionFromTag('0.1.5-store'), /must match vX.Y.Z-store/);
});

test('buildSubmissionUpdate marks copied packages for deletion before adding pending uploads', () => {
  const created = {
    id: 'submission-1',
    status: 'PendingCommit',
    fileUploadUrl: 'https://blob.example/upload',
    friendlyName: 'Submission 2',
    applicationCategory: 'DeveloperTools',
    visibility: 'Public',
    targetPublishMode: 'Immediate',
    pricing: { priceId: 'Free' },
    listings: { 'en-us': { baseListing: { title: 'Quay' } } },
    applicationPackages: [
      {
        fileName: 'Quay_0.1.4_x64.msix',
        fileStatus: 'Uploaded',
        minimumDirectXVersion: 'None',
        minimumSystemRam: 'None',
      },
      {
        fileName: 'Quay_0.1.4_arm64.msix',
        fileStatus: 'Uploaded',
        minimumDirectXVersion: 'None',
        minimumSystemRam: 'None',
      },
    ],
    packageDeliveryOptions: { isMandatoryUpdate: false },
    trailers: [],
  };

  const payload = buildSubmissionUpdate(created, [
    'Quay_0.1.5_x64.msix',
    'Quay_0.1.5_arm64.msix',
  ]);

  assert.equal(payload.id, undefined);
  assert.equal(payload.status, undefined);
  assert.equal(payload.fileUploadUrl, undefined);
  assert.equal(payload.friendlyName, undefined);
  assert.equal(payload.applicationCategory, 'DeveloperTools');
  assert.equal(payload.visibility, 'Public');
  assert.deepEqual(payload.applicationPackages, [
    {
      fileName: 'Quay_0.1.4_x64.msix',
      fileStatus: 'PendingDelete',
      minimumDirectXVersion: 'None',
      minimumSystemRam: 'None',
    },
    {
      fileName: 'Quay_0.1.4_arm64.msix',
      fileStatus: 'PendingDelete',
      minimumDirectXVersion: 'None',
      minimumSystemRam: 'None',
    },
    {
      fileName: 'Quay_0.1.5_x64.msix',
      fileStatus: 'PendingUpload',
      minimumDirectXVersion: 'None',
      minimumSystemRam: 'None',
    },
    {
      fileName: 'Quay_0.1.5_arm64.msix',
      fileStatus: 'PendingUpload',
      minimumDirectXVersion: 'None',
      minimumSystemRam: 'None',
    },
  ]);
});

test('runStoreSubmission creates, updates, uploads, commits, and stops after Store accepts preprocessing', async () => {
  const calls = [];
  const responses = [
    { access_token: 'token-123' },
    {
      id: 'submission-42',
      fileUploadUrl: 'https://blob.example/upload?sas=1',
      applicationCategory: 'DeveloperTools',
      visibility: 'Public',
      targetPublishMode: 'Immediate',
      pricing: { priceId: 'Free' },
      listings: {},
      applicationPackages: [],
      packageDeliveryOptions: {},
      trailers: [],
    },
    { id: 'submission-42', status: 'PendingCommit' },
    {},
    { status: 'CommitStarted', statusDetails: { errors: [] } },
    { status: 'PreProcessing', statusDetails: { errors: [] } },
  ];

  const fakeFetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const body = responses.shift();
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const result = await runStoreSubmission({
    tenantId: 'tenant',
    clientId: 'client',
    clientSecret: 'secret',
    applicationId: '9TEST',
    packageNames: ['Quay_0.1.5_x64.msix', 'Quay_0.1.5_arm64.msix'],
    zipBytes: Buffer.from('zip'),
    fetchImpl: fakeFetch,
    sleep: async () => {},
    maxPollAttempts: 3,
  });

  assert.deepEqual(result, { submissionId: 'submission-42', status: 'PreProcessing' });
  assert.equal(calls.length, 6);
  assert.match(calls[0].url, /login\.microsoftonline\.com\/tenant\/oauth2\/token$/);
  assert.equal(calls[1].init.method, 'POST');
  assert.match(calls[1].url, /applications\/9TEST\/submissions$/);
  assert.equal(calls[2].init.method, 'PUT');
  assert.match(calls[2].url, /submissions\/submission-42$/);
  assert.equal(calls[3].init.method, 'PUT');
  assert.equal(calls[3].url, 'https://blob.example/upload?sas=1');
  assert.equal(calls[3].init.headers['x-ms-blob-type'], 'BlockBlob');
  assert.equal(calls[4].init.method, 'POST');
  assert.match(calls[4].url, /submission-42\/commit$/);
  assert.match(calls[5].url, /submission-42\/status$/);
});

test('selectStorePackages requires exactly matching x64 and arm64 MSIX files for the store tag version', () => {
  assert.deepEqual(
    selectStorePackages([
      'notes.txt',
      'Quay_0.1.5_arm64.msix',
      'Quay_0.1.5_x64.msix',
    ], '0.1.5'),
    ['Quay_0.1.5_x64.msix', 'Quay_0.1.5_arm64.msix'],
  );

  assert.throws(
    () => selectStorePackages(['Quay_0.1.4_x64.msix', 'Quay_0.1.5_arm64.msix'], '0.1.5'),
    /Expected Store MSIX artifacts/,
  );
});
