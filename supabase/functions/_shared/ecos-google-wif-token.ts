const STS_URL = "https://sts.googleapis.com/v1/token";
const IAM_CREDENTIALS_URL = "https://iamcredentials.googleapis.com/v1";
const MAX_PROVIDER_RESPONSE_BYTES = 64 * 1024;

export type ECOSCloudRunIdentityInput = Readonly<{
  subjectToken: string;
  providerResource: string;
  serviceAccountEmail: string;
  serviceAudience: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}>;

export async function mintECOSCloudRunIdToken(
  input: ECOSCloudRunIdentityInput,
): Promise<string> {
  const subjectToken = required(input.subjectToken, "subject_token");
  const providerResource = required(
    input.providerResource,
    "provider_resource",
  );
  const serviceAccountEmail = required(
    input.serviceAccountEmail,
    "service_account_email",
  );
  const serviceAudience = required(
    input.serviceAudience,
    "service_audience",
  );
  if (!providerResource.startsWith("//iam.googleapis.com/projects/")) {
    throw new Error("wif_provider_resource_invalid");
  }
  if (
    !/^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/.test(
      serviceAccountEmail,
    )
  ) throw new Error("wif_service_account_invalid");
  if (
    !/^https:\/\/[^/\s]+\.run\.app\/?$/.test(serviceAudience) ||
    new URL(serviceAudience).hostname.includes("---")
  ) throw new Error("wif_service_audience_invalid");

  const fetchImpl = input.fetchImpl || fetch;
  const exchangeBody = new URLSearchParams({
    audience: providerResource,
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
    scope: "https://www.googleapis.com/auth/cloud-platform",
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    subject_token: subjectToken,
  });
  const exchangeResponse = await fetchImpl(STS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: exchangeBody.toString(),
    redirect: "error",
    signal: input.signal,
  });
  const exchangePayload = await boundedJson(exchangeResponse);
  const federatedAccessToken = requiredPayloadText(
    exchangeResponse,
    exchangePayload,
    "access_token",
    "wif_exchange_failed",
  );

  const identityResponse = await fetchImpl(
    `${IAM_CREDENTIALS_URL}/projects/-/serviceAccounts/${
      encodeURIComponent(serviceAccountEmail)
    }:generateIdToken`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${federatedAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ audience: serviceAudience, includeEmail: true }),
      redirect: "error",
      signal: input.signal,
    },
  );
  const identityPayload = await boundedJson(identityResponse);
  return requiredPayloadText(
    identityResponse,
    identityPayload,
    "token",
    "cloud_run_identity_token_failed",
  );
}

async function boundedJson(
  response: Response,
): Promise<Record<string, unknown>> {
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new Error("identity_provider_response_too_large");
  }
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function requiredPayloadText(
  response: Response,
  payload: Record<string, unknown>,
  field: string,
  errorCode: string,
) {
  const value = typeof payload[field] === "string" ? payload[field].trim() : "";
  if (!response.ok || !value) {
    throw new Error(`${errorCode}:${response.status}`);
  }
  return value;
}

function required(value: string, name: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name}_required`);
  return normalized;
}
