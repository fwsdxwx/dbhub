/**
 * Client Identifier Utility
 * Extracts client information from MCP request context
 */

/**
 * Extract client identifier from request context
 * Returns User-Agent for HTTP transport, "stdio" for STDIO transport
 *
 * @param ctx - The context passed by MCP SDK to tool handlers
 * @returns Client identifier string (User-Agent or "stdio")
 */
export function getClientIdentifier(ctx: any): string {
  // MCP SDK v2 exposes the HTTP request as a Web Standard Request at ctx.http.req
  // (undefined on stdio transport)
  const userAgent = ctx?.http?.req?.headers.get("user-agent");
  if (userAgent) {
    return userAgent;
  }

  // Default for STDIO mode
  return "stdio";
}
