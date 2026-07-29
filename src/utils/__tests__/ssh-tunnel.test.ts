import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SSHTunnel } from '../ssh-tunnel.js';
import type { SSHTunnelConfig } from '../../types/ssh.js';

// Capture the configs passed to ssh2's Client.connect so tests can assert on
// them without any real network I/O.
const { connectCalls } = vi.hoisted(() => ({
  connectCalls: [] as Array<Record<string, unknown>>,
}));

// Mock ssh2 so no test ever dials a real SSH server. The mocked client records
// the connect config, never emits 'ready', and asynchronously emits 'error' to
// simulate an unreachable host — establish() always settles deterministically.
vi.mock('ssh2', () => {
  class MockClient {
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();

    on(event: string, cb: (...args: unknown[]) => void): this {
      const arr = this.listeners.get(event) ?? [];
      arr.push(cb);
      this.listeners.set(event, arr);
      return this;
    }

    removeListener(event: string, cb: (...args: unknown[]) => void): this {
      const arr = this.listeners.get(event) ?? [];
      this.listeners.set(event, arr.filter((fn) => fn !== cb));
      return this;
    }

    connect(config: Record<string, unknown>): void {
      connectCalls.push(config);
      queueMicrotask(() => {
        for (const cb of this.listeners.get('error') ?? []) {
          cb(new Error('mock connect failure'));
        }
      });
    }

    destroy(): void {}

    end(): void {}
  }

  return { Client: MockClient };
});

describe('SSHTunnel', () => {
  beforeEach(() => {
    connectCalls.length = 0;
  });

  describe('Initial State', () => {
    it('should have initial state as disconnected', () => {
      const tunnel = new SSHTunnel();
      expect(tunnel.getIsConnected()).toBe(false);
      expect(tunnel.getTunnelInfo()).toBeNull();
    });
  });

  describe('Tunnel State Management', () => {
    it('should prevent establishing multiple tunnels', async () => {
      const tunnel = new SSHTunnel();

      // Set tunnel as connected (simulating a connected state)
      (tunnel as any).isConnected = true;

      const config: SSHTunnelConfig = {
        host: 'ssh.example.com',
        username: 'testuser',
        password: 'testpass',
      };

      const options = {
        targetHost: 'database.local',
        targetPort: 5432,
      };

      await expect(tunnel.establish(config, options)).rejects.toThrow(
        'SSH tunnel is already established'
      );
    });

    it('should reject concurrent establish calls', async () => {
      const tunnel = new SSHTunnel();

      const config: SSHTunnelConfig = {
        host: 'ssh.example.com',
        username: 'testuser',
        password: 'testpass',
      };

      const options = {
        targetHost: 'database.local',
        targetPort: 5432,
      };

      // Start first establish call (fails via the mocked client's error, but
      // only after the second call below has already been rejected)
      const promise1 = tunnel.establish(config, options).catch(() => {});

      // Immediately try second establish call - should be rejected
      const promise2 = tunnel.establish(config, options);

      await expect(promise2).rejects.toThrow('SSH tunnel is already established');
      await promise1;
    });

    it('should reset connection state after failed establish', async () => {
      const tunnel = new SSHTunnel();

      const config: SSHTunnelConfig = {
        host: 'ssh.example.com',
        username: 'testuser',
        // Missing both password and privateKey - will fail validation
      };

      const options = {
        targetHost: 'database.local',
        targetPort: 5432,
      };

      // First establish should fail
      await expect(tunnel.establish(config, options)).rejects.toThrow();

      // After failure, isConnected should be false
      expect(tunnel.getIsConnected()).toBe(false);

      // Should be able to try establishing again (even though it will fail again)
      await expect(tunnel.establish(config, options)).rejects.toThrow();
    });

    it('should handle close when not connected', async () => {
      const tunnel = new SSHTunnel();

      // Should not throw when closing disconnected tunnel
      await expect(tunnel.close()).resolves.toBeUndefined();
    });
  });

  describe('Private Key Resolution', () => {
    it('should accept base64-encoded private key', async () => {
      const tunnel = new SSHTunnel();
      // A minimal PEM private key structure, base64-encoded
      const fakeKey = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg==\n-----END PRIVATE KEY-----\n';
      const base64Key = Buffer.from(fakeKey).toString('base64');

      const config: SSHTunnelConfig = {
        host: 'ssh.example.com',
        username: 'testuser',
        privateKey: base64Key,
      };

      const options = {
        targetHost: 'database.local',
        targetPort: 5432,
      };

      // The base64 key passes local validation, so establish() proceeds to the
      // (mocked) SSH connection and fails there — not at key resolution.
      await expect(tunnel.establish(config, options)).rejects.toThrow(
        'SSH connection error: mock connect failure'
      );

      // The key handed to ssh2 must be the decoded PEM, proving the base64
      // content was recognized and decoded rather than treated as a file path.
      expect(connectCalls).toHaveLength(1);
      expect(Buffer.isBuffer(connectCalls[0].privateKey)).toBe(true);
      expect((connectCalls[0].privateKey as Buffer).toString('utf8')).toBe(fakeKey);
    });

    it('should reject invalid private key that is neither file nor base64', async () => {
      const tunnel = new SSHTunnel();

      const config: SSHTunnelConfig = {
        host: 'ssh.example.com',
        username: 'testuser',
        privateKey: 'not-a-file-and-not-base64-key',
      };

      const options = {
        targetHost: 'database.local',
        targetPort: 5432,
      };

      await expect(tunnel.establish(config, options)).rejects.toThrow(
        'SSH key is neither a valid file path nor a base64-encoded private key'
      );

      // Fails during local key resolution — ssh2 is never asked to connect.
      expect(connectCalls).toHaveLength(0);
    });
  });
});
