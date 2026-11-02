/**
 * LocalFlow E2E Test Suite - Tier 2: SSRF Network Protection Boundaries
 * Verifies IPv6 variations, obfuscated decimal/octal IPs, non-standard ports, and cloud metadata defense.
 */

import { describe, it, expect } from '../harness/index.ts';
import { SSRFProtectionEngine, SSRFBlockedError } from '../harness/security-harness.ts';

describe('Tier 2: Boundary - SSRF Network Protection Boundaries', () => {
  const ssrf = new SSRFProtectionEngine();

  it('B-SSRF-1: should block IPv6 loopback variants (::1, [::1], 0:0:0:0:0:0:0:1)', () => {
    expect(() => ssrf.validateUrl('http://[::1]:8080/')).toThrow(SSRFBlockedError);
    expect(() => ssrf.validateUrl('http://[0:0:0:0:0:0:0:1]/')).toThrow(SSRFBlockedError);
    expect(() => ssrf.validateUrl('http://[::]/')).toThrow(SSRFBlockedError);
  });

  it('B-SSRF-2: should block IPv6 Unique Local (fc00::/7) and Link-Local (fe80::/10)', () => {
    expect(() => ssrf.validateUrl('http://[fc00::1]/admin')).toThrow(SSRFBlockedError);
    expect(() => ssrf.validateUrl('http://[fd12:3456:789a::1]:3000/')).toThrow(SSRFBlockedError);
    expect(() => ssrf.validateUrl('http://[fe80::1]/service')).toThrow(SSRFBlockedError);
  });

  it('B-SSRF-3: should decode and block obfuscated decimal, hex, and octal IP representations', () => {
    // 2130706433 in decimal is 127.0.0.1
    expect(() => ssrf.validateUrl('http://2130706433/')).toThrow(SSRFBlockedError);
    // 0x7f000001 in hex is 127.0.0.1
    expect(() => ssrf.validateUrl('http://0x7f000001/')).toThrow(SSRFBlockedError);
    // 0177.0.0.1 in octal is 127.0.0.1
    expect(() => ssrf.validateUrl('http://0177.0.0.1/')).toThrow(SSRFBlockedError);
  });

  it('B-SSRF-4: should block private IPs across high non-standard ports (49152..65535)', () => {
    expect(() => ssrf.validateUrl('http://10.0.0.1:49152/internal-api')).toThrow(SSRFBlockedError);
    expect(() => ssrf.validateUrl('http://192.168.1.1:65535/router')).toThrow(SSRFBlockedError);
    expect(() => ssrf.validateUrl('http://172.16.0.1:8443/')).toThrow(SSRFBlockedError);
  });

  it('B-SSRF-5: should block cloud instance metadata paths and domain variations', () => {
    expect(() => ssrf.validateUrl('http://169.254.169.254/latest/meta-data/iam/security-credentials/')).toThrow(SSRFBlockedError);
    expect(() => ssrf.validateUrl('http://metadata.google.internal/computeMetadata/v1/')).toThrow(SSRFBlockedError);
  });

  it('B-SSRF-6: should allow whitelisted internal hosts while maintaining strict block on non-whitelisted private IPs', () => {
    const customEngine = new SSRFProtectionEngine(['internal-service.local']);

    // Allowed because it is explicitly whitelisted
    expect(() => customEngine.validateUrl('http://internal-service.local/api')).not.toThrow();

    // Other private hosts remain strictly blocked
    expect(() => customEngine.validateUrl('http://10.0.0.5/api')).toThrow(SSRFBlockedError);
    expect(() => customEngine.validateUrl('http://127.0.0.1/api')).toThrow(SSRFBlockedError);
  });
});
