import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

export interface PinnedAgentOptions {
  /** Addresses already validated against the SSRF policy; the socket may use only these. */
  pinnedIps: string[];
  isHttps: boolean;
}

export function createPinnedAgent(options: PinnedAgentOptions): http.Agent | https.Agent {
  const addresses = options.pinnedIps.map((address) => ({
    address,
    family: net.isIPv6(address) ? 6 : 4,
  }));

  const agentOptions: http.AgentOptions = {
    keepAlive: false,
    lookup: ((_hostname: string, lookupOptions: { all?: boolean }, callback: Function) => {
      // Answer from the pre-validated list only (no second DNS query to rebind). Node ≥ 20
      // asks for `all` addresses and tries each (IPv6 and IPv4); answering with a bare
      // string there failed every request to a host name ("Invalid IP address: undefined").
      if (lookupOptions?.all) callback(null, addresses);
      else callback(null, addresses[0]!.address, addresses[0]!.family);
    }) as http.AgentOptions['lookup'],
  };

  return options.isHttps ? new https.Agent(agentOptions) : new http.Agent(agentOptions);
}
