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
