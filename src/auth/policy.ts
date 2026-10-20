export const PASSWORD_MINIMUM_LENGTH = 12;
export const PASSWORD_MAXIMUM_LENGTH = 128;
export const SESSION_LIFETIME_SECONDS = 60 * 60 * 24 * 7;
export const SESSION_RENEWAL_AGE_SECONDS = 60 * 60 * 24;

/** The remote MCP endpoint and the pages its OAuth flow sends the Administrator to. */
export const MCP_ENDPOINT_PATH = "/mcp";
export const MCP_LOGIN_PAGE = "/admin/login";
export const MCP_CONSENT_PAGE = "/admin/oauth/consent";
export const MCP_AUTHORIZE_PATH = "/api/auth/mcp/authorize";
export const MCP_ACCESS_TOKEN_LIFETIME_SECONDS = 60 * 60;
export const MCP_REFRESH_TOKEN_LIFETIME_SECONDS = 60 * 60 * 24 * 7;
