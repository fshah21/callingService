const {
  S3Client,
  PutObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  PutBucketPolicyCommand,
} = require('@aws-sdk/client-s3');
const config = require('../config');
const logger = require('../utils/logger');

const client = new S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  forcePathStyle: true, // required for MinIO / any non-AWS S3-compatible endpoint
  credentials: {
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey,
  },
});

const PUBLIC_READ_POLICY = JSON.stringify({
  Version: '2012-10-17',
  Statement: [
    {
      Effect: 'Allow',
      Principal: '*',
      Action: ['s3:GetObject'],
      Resource: [`arn:aws:s3:::${config.s3.bucket}/*`],
    },
  ],
});

let bucketReadyPromise = null;

// Lazily creates the bucket (and makes it public-read) on first use rather than requiring a
// separate provisioning step — convenient for a mock/local S3 (MinIO) backend standing in for
// what would otherwise be a private bucket served through presigned URLs. Memoized so repeated
// uploads don't re-check.
function ensureBucket() {
  if (!bucketReadyPromise) {
    bucketReadyPromise = client
      .send(new HeadBucketCommand({ Bucket: config.s3.bucket }))
      .catch(() => client.send(new CreateBucketCommand({ Bucket: config.s3.bucket })))
      .then(() => client.send(new PutBucketPolicyCommand({ Bucket: config.s3.bucket, Policy: PUBLIC_READ_POLICY })))
      .catch((err) => {
        logger.warn({ err: err.message }, 'could not confirm/create/configure s3 bucket');
      });
  }
  return bucketReadyPromise;
}

async function putObject(key, body, contentType) {
  await ensureBucket();
  await client.send(
    new PutObjectCommand({ Bucket: config.s3.bucket, Key: key, Body: body, ContentType: contentType }),
  );
}

function getObjectUrl(key) {
  return `${config.s3.publicEndpoint.replace(/\/$/, '')}/${config.s3.bucket}/${key}`;
}

module.exports = { putObject, getObjectUrl };
