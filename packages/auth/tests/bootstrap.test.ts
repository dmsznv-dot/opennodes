import { describe, it, expect } from 'vitest';
import {
  BootstrapService,
  BootstrapDatabaseAdapter,
  AlreadyBootstrappedError,
  ScryptPasswordHasher,
} from '../src/index.js';

describe('One-Time Owner Bootstrap Service', () => {
  let isBootstrappedState = false;
  let createdUser: any = null;

  const mockDbAdapter: BootstrapDatabaseAdapter = {
    async isSystemBootstrapped() {
      return isBootstrappedState;
    },
    async createOwnerAndWorkspace(user) {
      isBootstrappedState = true;
      createdUser = {
        userId: 'user_owner_1',
        email: user.email,
        workspaceId: 'ws_primary_1',
        workspaceName: user.workspaceName,
        role: 'OWNER' as const,
      };
      return createdUser;
    },
  };

  const hasher = new ScryptPasswordHasher();
  const service = new BootstrapService(mockDbAdapter, hasher);

  it('reports unbootstrapped state initially', async () => {
    isBootstrappedState = false;
    expect(await service.isBootstrapped()).toBe(false);
  });

  it('bootstraps owner successfully on fresh system', async () => {
    const result = await service.bootstrapOwner({
      email: 'owner@localflow.dev',
      password: 'initial-owner-password',
      fullName: 'Primary Owner',
      workspaceName: 'Acme Corp',
    });

    expect(result.email).toBe('owner@localflow.dev');
    expect(result.role).toBe('OWNER');
    expect(result.workspaceName).toBe('Acme Corp');
    expect(await service.isBootstrapped()).toBe(true);
  });

  it('rejects subsequent bootstrap calls with AlreadyBootstrappedError', async () => {
    await expect(
      service.bootstrapOwner({
        email: 'attacker@localflow.dev',
        password: 'attacker-password',
      })
    ).rejects.toThrow(AlreadyBootstrappedError);
  });
});
