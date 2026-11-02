export class SecretRegistry {
  private readonly secrets = new Set<string>();

  public register(secret: unknown): void {
    if (typeof secret === 'string' && secret.trim().length >= 4) {
      this.secrets.add(secret.trim());
    } else if (secret && typeof secret === 'object') {
      for (const val of Object.values(secret as Record<string, unknown>)) {
        this.register(val);
      }
    }
  }

  public redactString(str: string): string {
    if (!str || this.secrets.size === 0) return str;
    let result = str;
    for (const secret of this.secrets) {
      if (result.includes(secret)) {
        result = result.split(secret).join('[REDACTED_SECRET]');
      }
    }
    return result;
  }

  public clear(): void {
    this.secrets.clear();
  }

  public size(): number {
    return this.secrets.size;
  }
}
