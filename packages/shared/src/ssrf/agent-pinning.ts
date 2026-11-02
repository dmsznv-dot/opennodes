import http from 'node:http';
import https from 'node:https';

export interface PinnedAgentOptions {
  pinnedIp: string;
  isHttps: boolean;
}

export function createPinnedAgent(options: PinnedAgentOptions): http.Agent | https.Agent {
  const { pinnedIp, isHttps } = options;
  const family = pinnedIp.includes(':') ? 6 : 4;

  const agentOptions: http.AgentOptions = {
    keepAlive: false,
    lookup: (_hostname, _lookupOptions, callback) => {
      // Pin lookup to the pre-validated IP
      callback(null, pinnedIp, family);
    },
  };

  return isHttps ? new https.Agent(agentOptions) : new http.Agent(agentOptions);
}
