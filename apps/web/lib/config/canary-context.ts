import { createHmac } from "node:crypto";

const AUTHENTICATED_TENANT = Symbol.for("pali-docs.authenticated-tenant");

export interface AuthenticatedTenantContext {
  tenantId: string;
}

type ContextRequest = Request & {
  [AUTHENTICATED_TENANT]?: AuthenticatedTenantContext;
};

/**
 * Server middleware is the only producer for this context. HTTP headers and request JSON
 * are deliberately not accepted because either can be supplied by an untrusted client.
 */
export function withAuthenticatedTenant(
  request: Request,
  context: AuthenticatedTenantContext,
): Request {
  const tenantId = context.tenantId.trim();
  if (!tenantId) throw new Error("authenticated tenant identity is required");
  Object.defineProperty(request, AUTHENTICATED_TENANT, {
    configurable: false,
    enumerable: false,
    value: Object.freeze({ tenantId }),
    writable: false,
  });
  return request;
}

export function getAuthenticatedTenantId(request: Request): string | undefined {
  const context = (request as ContextRequest)[AUTHENTICATED_TENANT];
  return context?.tenantId;
}

export function getAuthenticatedAccessScope(
  request: Request,
): Record<string, string> | undefined {
  const tenantId = getAuthenticatedTenantId(request);
  return tenantId === undefined ? undefined : { tenant: tenantId };
}

function optionalStringList(
  scope: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const value = scope[key];
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length > 20 ||
    value.some(
      (item): item is string =>
        typeof item !== "string" || !item.trim() || item.length > 200,
    )
  ) {
    throw new Error(`authenticated Principal ${key} claim is invalid`);
  }
  return value.map((item) => item.trim());
}

export function createPrincipalToken(
  scope: Record<string, unknown>,
  secret: string,
  now = Date.now(),
): string {
  const tenant = scope.tenant;
  const principalId = scope.principalId;
  const visibility = scope.visibility;
  if (
    typeof tenant !== "string" ||
    !tenant.trim() ||
    tenant.length > 200 ||
    !secret.trim() ||
    (principalId !== undefined &&
      (typeof principalId !== "string" ||
        !principalId.trim() ||
        principalId.length > 200)) ||
    (visibility !== undefined &&
      (typeof visibility !== "string" ||
        !visibility.trim() ||
        visibility.length > 200))
  ) {
    throw new Error("authenticated Principal identity is required");
  }
  const roles = optionalStringList(scope, "roles");
  const permissions = optionalStringList(scope, "permissions");
  const documentIds = optionalStringList(scope, "documentIds");
  const payload = {
    iss: "pali-docs-bff",
    aud: "pali-docs-api",
    sub:
      typeof principalId === "string" && principalId.trim()
        ? principalId.trim()
        : "bff",
    tenantId: tenant.trim(),
    ...(roles === undefined ? {} : { roles }),
    ...(permissions === undefined ? {} : { permissions }),
    ...(documentIds === undefined ? {} : { documentIds }),
    ...(typeof visibility === "string" ? { visibility: visibility.trim() } : {}),
    iat: Math.floor(now / 1_000),
    exp: Math.floor(now / 1_000) + 300,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signingInput = `v1.${encodedPayload}`;
  const signature = createHmac("sha256", secret.trim())
    .update(signingInput)
    .digest("base64url");
  return `${signingInput}.${signature}`;
}
