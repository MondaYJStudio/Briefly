/** What the consent page and the Connected Apps list show about an MCP client. */
export interface OAuthClientSummary {
  clientId: string;
  name: string;
  /** Hosts the client may send authorization codes to. */
  redirectHosts: string[];
}

export interface ConnectedApp extends OAuthClientSummary {
  connectedAt: string;
  lastAuthorizedAt: string;
}
