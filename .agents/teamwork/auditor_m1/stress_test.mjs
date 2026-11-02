import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// 1. Load compiled packages
import {
  AesGcmEncryptionService,
  EnvKeyProvider,
  ScryptPasswordHasher,
  RbacPolicyEngine,
  PERMISSIONS,
  ROLES,
  maskSecret
} from '../../../packages/auth/dist/index.js';

import {
  normalizeIp,
  isBlockedIp,
  isBlockedHostname,
  isIpInCidr,
  SafeHttpClient,
  createPinnedAgent
} from '../../../packages/shared/dist/index.js';

import {
  detectCycles,
  wouldCreateCycle,
  arePortsCompatible,
  validateWorkflowGraph,
  computeWorkflowChecksum
} from '../../../packages/workflow-schema/dist/index.js';

import {
  redact,
  redactString,
  SecretRegistry
} from '../../../packages/observability/dist/index.js';

import {
  createInMemoryDb
} from '../../../packages/db/dist/index.js';
import * as schema from '../../../packages/db/dist/schema/index.js';
import { eq } from '../../../packages/db/node_modules/drizzle-orm/index.js';

async function runAdversarialAudit() {
  console.log('--- STARTING ADVERSARIAL INTEGRITY STRESS TESTS ---');

  // TEST 1: AES-256-GCM Cryptographic Integrity & Nonce Randomness
  console.log('\n[1/5] Testing AES-256-GCM Envelope Encryption...');
  const masterKey = crypto.randomBytes(32).toString('hex');
  const keyProvider = new EnvKeyProvider(masterKey, 1);
  const cryptoService = new AesGcmEncryptionService(keyProvider);

  const ivs = new Set();
  const iterations = 200;
  for (let i = 0; i < iterations; i++) {
    const enc = await cryptoService.encrypt('identical-payload-content', 'tenant-aad-ctx');
    assert.strictEqual(ivs.has(enc.iv), false, `CRITICAL: Duplicate IV generated at iteration ${i}!`);
    ivs.add(enc.iv);

    // Bit-flip ciphertext
    const rawCipher = Buffer.from(enc.ciphertext, 'base64');
    rawCipher[rawCipher.length - 1] ^= 0x01;
    const tamperedCipher = { ...enc, ciphertext: rawCipher.toString('base64') };
    await assert.rejects(
      async () => cryptoService.decrypt(tamperedCipher, 'tenant-aad-ctx'),
      /Decryption failed/,
      'Ciphertext tampering MUST fail authentication'
    );

    // Bit-flip authTag
    const rawTag = Buffer.from(enc.authTag, 'base64');
    rawTag[0] ^= 0x01;
    const tamperedTag = { ...enc, authTag: rawTag.toString('base64') };
    await assert.rejects(
      async () => cryptoService.decrypt(tamperedTag, 'tenant-aad-ctx'),
      /Decryption failed/,
      'Auth tag tampering MUST fail authentication'
    );

    // Tampered AAD
    await assert.rejects(
      async () => cryptoService.decrypt(enc, 'wrong-aad-ctx'),
      /Decryption failed/,
      'AAD mismatch MUST fail authentication'
    );

    // Clean decrypt
    const clean = await cryptoService.decrypt(enc, 'tenant-aad-ctx');
    assert.strictEqual(clean, 'identical-payload-content');
  }
  console.log(`  ✓ Passed: 200/200 distinct CSPRNG nonces generated, all tampering attempts rejected.`);

  // TEST 2: Graph Algorithms & Cycle Prevention Stress Testing
  console.log('\n[2/5] Testing Graph Algorithms & Cycle Detection...');
  // Acyclic chain of 500 nodes
  const largeNodes = [];
  const largeEdges = [];
  for (let i = 0; i < 500; i++) {
    largeNodes.push({ id: `node_${i}`, type: i === 0 ? 'trigger.manual' : 'primitive.map', inputs: [], outputs: [] });
    if (i > 0) {
      largeEdges.push({ id: `e_${i}`, source: `node_${i-1}`, target: `node_${i}` });
    }
  }
  const t0 = performance.now();
  const kahnResult = detectCycles(largeNodes, largeEdges);
  const t1 = performance.now();
  assert.strictEqual(kahnResult.hasCycle, false, 'Linear chain must have no cycle');
  assert.strictEqual(kahnResult.topologicalOrder.length, 500, 'Topological sort must order all 500 nodes');
  assert.ok(t1 - t0 < 50, `Kahn algorithm took ${t1 - t0}ms (expected < 50ms)`);
  console.log(`  ✓ Passed: 500-node topological sort in ${(t1 - t0).toFixed(2)}ms`);

  // Add back-edge to create cycle: node_499 -> node_0
  const cyclicEdges = [...largeEdges, { id: 'back_edge', source: 'node_499', target: 'node_0' }];
  const cycleResult = detectCycles(largeNodes, cyclicEdges);
  assert.strictEqual(cycleResult.hasCycle, true, 'Back-edge must be detected as cycle');
  assert.ok(cycleResult.cyclePath.length > 0, 'Cycle path must be extracted');
  console.log(`  ✓ Passed: Detected large cycle loop with ${cycleResult.cyclePath.length} path entries`);

  // Test wouldCreateCycle (BFS reachability)
  assert.strictEqual(wouldCreateCycle(largeEdges, { source: 'node_499', target: 'node_0' }), true);
  assert.strictEqual(wouldCreateCycle(largeEdges, { source: 'node_0', target: 'node_499' }), false);
  assert.strictEqual(wouldCreateCycle(largeEdges, { source: 'node_50', target: 'node_50' }), true, 'Self-loop');
  console.log('  ✓ Passed: Real-time BFS cycle rejection verified');

  // TEST 3: SSRF Normalizer & Blocklist
  console.log('\n[3/5] Testing SSRF Normalization & Blocklist Defense...');
  const maliciousIps = [
    '127.0.0.1',
    '127.127.127.127',
    '2130706433', // decimal 127.0.0.1
    '0x7f000001', // hex 127.0.0.1
    '0177.0.0.1', // octal 127.0.0.1
    '::ffff:127.0.0.1', // mapped IPv4
    '::ffff:7f00:1',
    '[::1]',
    '10.0.0.1',
    '10.255.255.254',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.0.1',
    '169.254.169.254',
    '169.254.1.1'
  ];

  for (const ip of maliciousIps) {
    const blocked = isBlockedIp(ip);
    assert.strictEqual(blocked, true, `CRITICAL: SSRF failed to block malicious IP representation: ${ip}`);
  }

  // Safe external IPs
  assert.strictEqual(isBlockedIp('8.8.8.8'), false, '8.8.8.8 must be allowed');
  assert.strictEqual(isBlockedIp('1.1.1.1'), false, '1.1.1.1 must be allowed');
  assert.strictEqual(isBlockedHostname('localhost'), true, 'localhost must be blocked');
  assert.strictEqual(isBlockedHostname('evil.internal'), true, '*.internal must be blocked');
  console.log(`  ✓ Passed: All ${maliciousIps.length} malicious IP representations blocked, benign IPs allowed`);

  // Socket pinning agent check
  const pinnedAgent = createPinnedAgent({ pinnedIp: '93.184.216.34', isHttps: false });
  assert.ok(pinnedAgent, 'Pinned agent created');
  console.log('  ✓ Passed: Socket-level DNS pinning agent initialized');

  // TEST 4: 4-Layer Secret Redaction
  console.log('\n[4/5] Testing 4-Layer Secret Redaction...');
  const secretReg = new SecretRegistry();
  secretReg.register('ultra_confidential_dynamic_token_99');

  const deepObj = {
    auth: {
      password: 'PlainPassword123',
      nested: {
        api_key: 'sk-abcdef12345678901234567890',
        bearer: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLeakThisJWT',
        aws: 'AKIAIOSFODNN7EXAMPLE',
        customDynamic: 'Data with ultra_confidential_dynamic_token_99 included',
        safeData: 'public text'
      }
    },
    items: [
      { id: 1, secret: 'item_secret' },
      { id: 2, desc: 'clean item' }
    ]
  };

  // Add circular reference
  deepObj.self = deepObj;

  const redactedResult = redact(deepObj, { secretRegistry: secretReg });
  assert.strictEqual(redactedResult.self, '[CIRCULAR]', 'Circular reference must be safely marked');
  assert.strictEqual(redactedResult.auth.password, '[REDACTED]', 'Password must be redacted');
  assert.strictEqual(redactedResult.auth.nested.api_key, '[REDACTED]', 'api_key must be redacted');
  assert.strictEqual(redactedResult.auth.nested.aws, '[REDACTED_AWS_KEY]', 'AWS key must be redacted');
  assert.strictEqual(redactedResult.auth.nested.safeData, 'public text', 'Safe data must be preserved');
  assert.strictEqual(redactedResult.items[0].secret, '[REDACTED]', 'Nested array secret must be redacted');
  assert.strictEqual(redactedResult.items[1].desc, 'clean item', 'Nested array clean data preserved');
  assert.ok(!JSON.stringify(redactedResult).includes('ultra_confidential_dynamic_token_99'), 'Dynamic secret leaked!');
  console.log('  ✓ Passed: Recursive redaction, regex patterns, circular references, and dynamic registry verified');

  // TEST 5: PGlite In-Memory DB & Cascading Relational Integrity
  console.log('\n[5/5] Testing PGlite PostgreSQL Schema & Cascade Constraints...');
  const db = await createInMemoryDb();
  assert.ok(db, 'PGlite initialized and synced');

  // Insert user
  const [user] = await db.insert(schema.users).values({
    email: 'auditor@localflow.test',
    passwordHash: 'hash',
    fullName: 'Forensic Auditor',
    isOwner: true
  }).returning();
  assert.ok(user.id, 'User created');

  // Insert workspace
  const [ws] = await db.insert(schema.workspaces).values({
    name: 'Auditor Workspace',
    slug: 'auditor-workspace'
  }).returning();
  assert.ok(ws.id, 'Workspace created');

  // Insert membership
  await db.insert(schema.memberships).values({
    userId: user.id,
    workspaceId: ws.id,
    role: 'OWNER'
  });

  // Insert credential
  await db.insert(schema.credentials).values({
    workspaceId: ws.id,
    name: 'Auditor Credential',
    type: 'openai',
    iv: 'iv_base64',
    authTag: 'tag_base64',
    ciphertext: 'cipher_base64'
  });

  // Cascade delete workspace
  await db.delete(schema.workspaces).where(eq(schema.workspaces.id, ws.id));

  // Verify child memberships and credentials were automatically cascaded
  const remainingMemberships = await db.select().from(schema.memberships).where(eq(schema.memberships.workspaceId, ws.id));
  assert.strictEqual(remainingMemberships.length, 0, 'Foreign key cascade on memberships failed');
  const remainingCreds = await db.select().from(schema.credentials).where(eq(schema.credentials.workspaceId, ws.id));
  assert.strictEqual(remainingCreds.length, 0, 'Foreign key cascade on credentials failed');

  // User still exists
  const remainingUsers = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
  assert.strictEqual(remainingUsers.length, 1, 'User should not be deleted');

  console.log('  ✓ Passed: PostgreSQL DDL, constraints, relations, and cascade deletions verified on PGlite');

  console.log('\n--- ALL ADVERSARIAL INTEGRITY STRESS TESTS PASSED CLEANLY ---');
}

runAdversarialAudit().catch((err) => {
  console.error('\nADVERSARIAL STRESS TEST FAILED:', err);
  process.exit(1);
});
