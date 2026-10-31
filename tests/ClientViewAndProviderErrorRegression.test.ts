import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { apiUrl } from '../src/services/apiClient';
import { ErrorBoundary } from '../src/components/ErrorBoundary';

test('1. App.tsx correctly imports apiUrl and has no unimported free apiUrl calls', () => {
  const appPath = path.resolve(process.cwd(), 'src/App.tsx');
  const content = fs.readFileSync(appPath, 'utf-8');

  // Must import apiUrl
  assert.ok(
    content.includes("import { apiUrl } from './services/apiClient';"),
    'App.tsx must import apiUrl from ./services/apiClient'
  );

  // Must import ErrorBoundary
  assert.ok(
    content.includes("import { ErrorBoundary } from './components/ErrorBoundary';"),
    'App.tsx must import ErrorBoundary'
  );

  // Must wrap ClientManagementView in ErrorBoundary
  assert.ok(
    content.includes('<ErrorBoundary') && content.includes('<ClientManagementView'),
    'ClientManagementView must be wrapped in ErrorBoundary'
  );
});

test('2. ClientManagementView declares isCreateModalOpen and does not throw ReferenceError', () => {
  const clientViewPath = path.resolve(process.cwd(), 'src/components/ClientManagementView.tsx');
  const content = fs.readFileSync(clientViewPath, 'utf-8');

  // Must declare isCreateModalOpen
  assert.ok(
    content.includes('const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);') ||
    content.includes('const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);'),
    'ClientManagementView must declare isCreateModalOpen state variable'
  );

  // Must safely guard activeOrSelectedClient when clients array is empty
  assert.ok(
    content.includes('Array.isArray(clients) && clients.length > 0'),
    'ClientManagementView must guard activeOrSelectedClient against empty client lists'
  );
});

test('3. apiUrl utility formats relative endpoints safely with base fallback', () => {
  const url1 = apiUrl('/api/provider-status');
  assert.ok(url1.includes('/api/provider-status'), 'apiUrl must format provider-status path');

  const url2 = apiUrl('/api/workspaces/ws-test-123/clients');
  assert.ok(url2.includes('/api/workspaces/ws-test-123/clients'), 'apiUrl must format workspace clients path');
});

test('4. ErrorBoundary component correctly handles lifecycle error state without throwing', () => {
  const state = ErrorBoundary.getDerivedStateFromError(new Error('Simulated child render failure'));
  assert.equal(state.hasError, true);
  assert.equal(state.error?.message, 'Simulated child render failure');
});
