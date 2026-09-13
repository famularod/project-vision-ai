const DEFAULT_STS_URL = 'https://sts.googleapis.com/v1/token';
const DEFAULT_IAM_CREDENTIALS_URL =
  'https://iamcredentials.googleapis.com/v1';

async function mintCloudRunIdToken({
  subjectToken,
  providerResource,
  serviceAccountEmail,
  serviceAudience,
  fetchImpl = fetch,
  stsUrl = DEFAULT_STS_URL,
  iamCredentialsUrl = DEFAULT_IAM_CREDENTIALS_URL,
}) {
  const token = requiredText(subjectToken, 'subjectToken');
  const provider = requiredText(providerResource, 'providerResource');
  const serviceAccount = requiredText(
    serviceAccountEmail,
    'serviceAccountEmail',
  );
  const audience = requiredText(serviceAudience, 'serviceAudience');
  if (!provider.startsWith('//iam.googleapis.com/projects/')) {
    throw new Error('providerResource must be a workload identity provider resource.');
  }
  if (!/^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/.test(serviceAccount)) {
    throw new Error('serviceAccountEmail must be a Google service account email.');
  }
  if (
    !/^https:\/\/[^/\s]+\.run\.app\/?$/.test(audience) ||
    new URL(audience).hostname.includes('---')
  ) {
    throw new Error('serviceAudience must be the untagged Cloud Run service URL.');
  }

  const exchangeBody = new URLSearchParams({
    audience: provider,
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    subject_token: token,
  });
  const exchangeResponse = await fetchImpl(stsUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: exchangeBody.toString(),
  });
  const exchangePayload = await safeJson(exchangeResponse);
  const federatedAccessToken = requiredPayloadText(
    exchangeResponse,
    exchangePayload,
    'access_token',
    'workload_identity_exchange_failed',
  );

  const identityResponse = await fetchImpl(
    `${iamCredentialsUrl}/projects/-/serviceAccounts/${encodeURIComponent(serviceAccount)}:generateIdToken`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${federatedAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ audience, includeEmail: true }),
    },
  );
  const identityPayload = await safeJson(identityResponse);
  return requiredPayloadText(
    identityResponse,
    identityPayload,
    'token',
    'cloud_run_identity_token_failed',
  );
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function requiredPayloadText(response, payload, field, errorCode) {
  const value = typeof payload?.[field] === 'string'
    ? payload[field].trim()
    : '';
  if (!response?.ok || !value) {
    const status = Number.isInteger(response?.status) ? response.status : 0;
    throw new Error(`${errorCode}:${status}`);
  }
  return value;
}

function requiredText(value, name) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new Error(`${name} is required.`);
  return normalized;
}

module.exports = { mintCloudRunIdToken };
