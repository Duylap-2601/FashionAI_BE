import { Request } from 'express';
import { SignedStateStore, readPlatformFromState } from './signed-state.store';

describe('SignedStateStore', () => {
  let store: SignedStateStore;
  const secret = 'test-secret-key';

  beforeEach(() => {
    store = new SignedStateStore({ secret, ttlSeconds: 600 });
  });

  describe('store', () => {
    it('should generate a valid signed state', (done) => {
      const req = { query: {} } as unknown as Request;

      store.store(req, undefined, (err, state) => {
        expect(err).toBeNull();
        expect(state).toBeTruthy();
        expect(typeof state).toBe('string');

        // State format: nonce.issuedAt.platform.signature
        const parts = state!.split('.');
        expect(parts).toHaveLength(4);

        // platform should be 'web' (default)
        expect(parts[2]).toBe('web');
        // signature should be present
        expect(parts[3]).toBeTruthy();

        done();
      });
    });

    it('should embed platform=web when not provided', (done) => {
      const req = { query: {} } as unknown as Request;

      store.store(req, undefined, (err, state) => {
        expect(err).toBeNull();
        const parts = state!.split('.');
        expect(parts[2]).toBe('web');
        done();
      });
    });

    it('should embed platform=mobile when provided', (done) => {
      const req = { query: { platform: 'mobile' } } as unknown as Request;

      store.store(req, undefined, (err, state) => {
        expect(err).toBeNull();
        const parts = state!.split('.');
        expect(parts[2]).toBe('mobile');
        done();
      });
    });

    it('should normalize platform to web for invalid values', (done) => {
      const req = { query: { platform: 'invalid' } } as unknown as Request;

      store.store(req, undefined, (err, state) => {
        expect(err).toBeNull();
        const parts = state!.split('.');
        expect(parts[2]).toBe('web');
        done();
      });
    });
  });

  describe('verify', () => {
    it('should verify a valid state', (done) => {
      const req = { query: { platform: 'mobile' } } as unknown as Request;

      store.store(req, undefined, (err, state) => {
        expect(err).toBeNull();

        store.verify(req, state!, undefined, (verifyErr, ok, result) => {
          expect(verifyErr).toBeNull();
          expect(ok).toBe(true);
          expect(result).toBe(state);
          done();
        });
      });
    });

    it('should reject missing state', (done) => {
      const req = {} as unknown as Request;

      store.verify(req, '', undefined, (err, ok, result) => {
        expect(err).toBeNull();
        expect(ok).toBe(false);
        expect(result).toHaveProperty('message');
        done();
      });
    });

    it('should reject malformed state (old 3-part format)', (done) => {
      const req = {} as unknown as Request;
      const oldFormat = 'nonce.issuedAt.signature';

      store.verify(req, oldFormat, undefined, (err, ok) => {
        expect(err).toBeNull();
        expect(ok).toBe(false);
        done();
      });
    });

    it('should reject state with invalid signature', (done) => {
      const req = { query: { platform: 'mobile' } } as unknown as Request;

      store.store(req, undefined, (err, state) => {
        const parts = state!.split('.');
        const tamperedState = `${parts[0]}.${parts[1]}.${parts[2]}.invalidsignature`;

        store.verify(req, tamperedState, undefined, (verifyErr, ok) => {
          expect(verifyErr).toBeNull();
          expect(ok).toBe(false);
          done();
        });
      });
    });
  });

  describe('readPlatformFromState', () => {
    it('should extract platform from valid state', (done) => {
      const req = { query: { platform: 'mobile' } } as unknown as Request;

      store.store(req, undefined, (err, state) => {
        const platform = readPlatformFromState(state);
        expect(platform).toBe('mobile');
        done();
      });
    });

    it('should return "web" for invalid state format', () => {
      expect(readPlatformFromState('invalid')).toBe('web');
    });

    it('should return "web" for non-string input', () => {
      expect(readPlatformFromState(null)).toBe('web');
      expect(readPlatformFromState(undefined)).toBe('web');
    });

    it('should return "web" for old 3-part state format', () => {
      const oldFormat = 'nonce.issuedAt.signature';
      expect(readPlatformFromState(oldFormat)).toBe('web');
    });
  });

  describe('different secrets', () => {
    it('should reject state signed with different secret', (done) => {
      const store1 = new SignedStateStore({ secret: 'secret1' });
      const store2 = new SignedStateStore({ secret: 'secret2' });
      const req = { query: {} } as unknown as Request;

      store1.store(req, undefined, (err, state) => {
        expect(err).toBeNull();

        // Try to verify with different secret
        store2.verify(req, state!, undefined, (verifyErr, ok) => {
          expect(verifyErr).toBeNull();
          expect(ok).toBe(false);
          done();
        });
      });
    });
  });
});
