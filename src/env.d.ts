interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

declare module "cloudflare:workers" {
  export const env: {
    CALLBACKS: KVNamespace;
  };
}
