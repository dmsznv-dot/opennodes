import { AlreadyBootstrappedError } from './errors.js';
import type { PasswordHasher } from '../password/hasher.js';

export interface BootstrapInput {
  email: string;
  password: string;
  fullName?: string;
  workspaceName?: string;
}

export interface BootstrapResult {
  userId: string;
  email: string;
  workspaceId: string;
  workspaceName: string;
  role: 'OWNER';
}

export interface BootstrapDatabaseAdapter {
  isSystemBootstrapped(): Promise<boolean>;
  createOwnerAndWorkspace(user: {
    email: string;
    passwordHash: string;
    fullName?: string;
    workspaceName: string;
  }): Promise<BootstrapResult>;
}

export class BootstrapService {
  constructor(
    private readonly db: BootstrapDatabaseAdapter,
    private readonly hasher: PasswordHasher
  ) {}

  public async isBootstrapped(): Promise<boolean> {
    return this.db.isSystemBootstrapped();
  }

  public async bootstrapOwner(input: BootstrapInput): Promise<BootstrapResult> {
    const alreadyBootstrapped = await this.db.isSystemBootstrapped();
    if (alreadyBootstrapped) {
      throw new AlreadyBootstrappedError(
        'Instance has already been bootstrapped. Owner creation is permanently locked.'
      );
    }

    if (!input.email || !input.email.includes('@')) {
      throw new Error('Valid email address is required.');
    }
    if (!input.password || input.password.length < 8) {
      throw new Error('Password must be at least 8 characters.');
    }

    const passwordHash = await this.hasher.hash(input.password);
    const workspaceName = input.workspaceName?.trim() || 'Primary Workspace';

    return this.db.createOwnerAndWorkspace({
      email: input.email.trim().toLowerCase(),
      passwordHash,
      fullName: input.fullName?.trim(),
      workspaceName,
    });
  }
}
