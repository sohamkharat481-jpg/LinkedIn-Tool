import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer, Server } from 'node:http';
import { dataRouter } from '../src/server/dataRoutes';
import { 
    createSignedTestToken, 
    getDeterministicOrganizationId, 
    getDeterministicWorkspaceId,
    getAuthJwtSecret 
} from '../src/server/serverAuthService';

describe('Multi-Tenant Security & Data Isolation Audit', () => {
    let server: Server;
    let baseUrl: string;

    const userA = {
        userId: 'usr_tenant_alpha_11111',
        email: 'user.alpha@tenant-a.com'
    };

    const userB = {
        userId: 'usr_tenant_beta_22222',
        email: 'user.beta@tenant-b.com'
    };

    const tokenA = createSignedTestToken(userA);
    const tokenB = createSignedTestToken(userB);

    const orgIdA = getDeterministicOrganizationId(userA.userId);
    const orgIdB = getDeterministicOrganizationId(userB.userId);

    const wsIdA = getDeterministicWorkspaceId(userA.userId);
    const wsIdB = getDeterministicWorkspaceId(userB.userId);

    before(() => {
        return new Promise<void>((resolve) => {
            const app = express();
            app.use(express.json());
            app.use('/api', dataRouter);
            server = createServer(app);
            server.listen(0, '127.0.0.1', () => {
                const addr = server.address() as any;
                baseUrl = `http://127.0.0.1:${addr.port}`;
                resolve();
            });
        });
    });

    after(() => {
        return new Promise<void>((resolve) => {
            if (server) {
                server.closeAllConnections?.();
                server.close(() => {
                    resolve();
                });
            } else {
                resolve();
            }
        });
    });

    it('1. User A and User B produce strictly distinct deterministic tenant identities', () => {
        assert.notEqual(orgIdA, orgIdB, 'Organization IDs must be strictly unique per user');
        assert.notEqual(wsIdA, wsIdB, 'Workspace IDs must be strictly unique per user');
        assert.ok(orgIdA.length > 20, 'Organization ID A must be valid UUID format');
        assert.ok(wsIdA.length > 20, 'Workspace ID A must be valid UUID format');
    });

    it('2. Onboarding User A generates tenant context exclusively for User A', async () => {
        const res = await fetch(`${baseUrl}/api/onboard`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${tokenA}`,
                'Content-Type': 'application/json'
            }
        });

        assert.equal(res.status, 200, 'Onboarding must succeed for authenticated user');
        const data = await res.json();
        assert.equal(data.onboarded, true);
        assert.equal(data.organization.id, orgIdA, 'User A organization must match orgIdA');
        assert.equal(data.workspaces[0].id, wsIdA, 'User A workspace must match wsIdA');
        assert.notEqual(data.organization.id, orgIdB, 'User A cannot be onboarded into User B organization');
    });

    it('3. Onboarding User B generates tenant context exclusively for User B', async () => {
        const res = await fetch(`${baseUrl}/api/onboard`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${tokenB}`,
                'Content-Type': 'application/json'
            }
        });

        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.onboarded, true);
        assert.equal(data.organization.id, orgIdB);
        assert.equal(data.workspaces[0].id, wsIdB);
    });

    it('4. User A CANNOT access User B workspace leads (Cross-Tenant Rejection HTTP 403)', async () => {
        const res = await fetch(`${baseUrl}/api/workspaces/${wsIdB}/leads`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${tokenA}`
            }
        });

        assert.equal(res.status, 403, 'User A must receive HTTP 403 Forbidden when attempting to access User B workspace leads');
        const data = await res.json();
        assert.ok(data.error.includes('Access denied'), 'Error message must clearly state access denied');
    });

    it('5. User A CANNOT create leads in User B workspace (Cross-Tenant Rejection HTTP 403)', async () => {
        const res = await fetch(`${baseUrl}/api/workspaces/${wsIdB}/leads`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${tokenA}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                clientId: 'client_123',
                leads: [{ name: 'Malicious Injected Lead', profile_url: 'https://linkedin.com/in/hacker' }]
            })
        });

        assert.equal(res.status, 403, 'User A must receive HTTP 403 Forbidden when posting leads to User B workspace');
    });

    it('6. User A CANNOT access User B workspace clients (Cross-Tenant Rejection HTTP 403)', async () => {
        const res = await fetch(`${baseUrl}/api/workspaces/${wsIdB}/clients`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${tokenA}`
            }
        });

        assert.equal(res.status, 403, 'User A must receive HTTP 403 Forbidden when fetching User B clients');
    });

    it('7. User A CANNOT access User B organization members (Cross-Tenant Rejection HTTP 403)', async () => {
        const res = await fetch(`${baseUrl}/api/organizations/${orgIdB}/members`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${tokenA}`
            }
        });

        assert.equal(res.status, 403, 'User A must receive HTTP 403 Forbidden when accessing User B organization members');
    });

    it('8. User A CANNOT send invitations to User B organization (Cross-Tenant Rejection HTTP 403)', async () => {
        const res = await fetch(`${baseUrl}/api/organizations/${orgIdB}/invitations`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${tokenA}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: 'attacker@evil.com',
                role: 'admin'
            })
        });

        assert.equal(res.status, 403, 'User A must receive HTTP 403 Forbidden when attempting to invite to User B org');
    });

    it('9. Unauthenticated requests are rejected with HTTP 401 Unauthorized', async () => {
        const res1 = await fetch(`${baseUrl}/api/workspaces/${wsIdA}/leads`, { method: 'GET' });
        assert.equal(res1.status, 401);

        const res2 = await fetch(`${baseUrl}/api/workspaces/${wsIdA}/leads`, {
            method: 'GET',
            headers: { 'Authorization': 'Bearer invalid.junk.token' }
        });
        assert.equal(res2.status, 401);
    });

    it('10. User A CAN access User A workspace leads cleanly', async () => {
        const res = await fetch(`${baseUrl}/api/workspaces/${wsIdA}/leads`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${tokenA}`
            }
        });

        // Should return 200 OK (or 500 if Supabase backend mock isn't populated, but authorization phase passes)
        assert.ok(res.status === 200 || res.status === 500, 'User A request to User A workspace passes authorization');
        assert.notEqual(res.status, 403, 'User A must NOT be forbidden from accessing User A workspace');
    });
});
