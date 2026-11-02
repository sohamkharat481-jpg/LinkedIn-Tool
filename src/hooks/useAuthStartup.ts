import { useState, useEffect, useRef } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '../services/supabase';
import { initAuthListener } from '../services/auth';
import { SupabaseDataService } from '../services/supabaseDataService';
import { Organization, Workspace } from '../types';
import { withTimeout } from '../utils/promiseTimeout';

export type StartupState =
  | 'INITIALIZING'
  | 'UNAUTHENTICATED'
  | 'AUTHENTICATING'
  | 'RESOLVING_ORGANIZATION'
  | 'RESOLVING_WORKSPACE'
  | 'READY'
  | 'ERROR';

export interface StartupResult {
  state: StartupState;
  user: User | null;
  organization: Organization | null;
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  error: string | null;
  failedPhase: string | null;
  phaseDuration: number;
}

export function useAuthStartup(): StartupResult {
  const [result, setResult] = useState<StartupResult>({
    state: 'INITIALIZING',
    user: null,
    organization: null,
    workspaces: [],
    activeWorkspace: null,
    error: null,
    failedPhase: null,
    phaseDuration: 0,
  });

  const startTimeRef = useRef<number>(Date.now());

  useEffect(() => {
    let isMounted = true;

    async function runStartup() {
      if (!isMounted) return;

      if (!supabase) {
        setResult(r => ({ ...r, state: 'ERROR', error: 'Database Configuration Missing' }));
        return;
      }

      setResult(r => ({ ...r, state: 'AUTHENTICATING' }));
      const authStart = Date.now();

      // 2. Initial Session Check & Auth Listener
      const [initialSession, initialUser] = await Promise.all([
          supabase.auth.getSession(),
          supabase.auth.getUser()
      ]);
      const sessionUser = initialSession.data.session?.user || initialUser.data.user;

      const handleUser = async (user: User | null) => {
          if (!isMounted) return;
          
          if (!user) {
            setResult(r => ({ ...r, user: null, state: 'UNAUTHENTICATED' }));
            return;
          }

          setResult(r => ({ ...r, user, state: 'RESOLVING_ORGANIZATION', phaseDuration: Date.now() - authStart }));
          const orgStart = Date.now();

          try {
            const onboardData = await withTimeout(
                SupabaseDataService.onboardUser(), 
                10000, 
                'Organization resolution timed out'
            );
            
            if (!isMounted) return;
            setResult(r => ({ 
                ...r, 
                organization: onboardData.organization, 
                workspaces: onboardData.workspaces, 
                state: 'RESOLVING_WORKSPACE',
                phaseDuration: Date.now() - orgStart
            }));

            const wsStart = Date.now();
            if (onboardData.workspaces.length > 0) {
              const ws = onboardData.workspaces[0];
              if (isMounted) {
                  setResult(r => ({ ...r, activeWorkspace: ws, state: 'READY', phaseDuration: Date.now() - wsStart }));
              }
            } else {
              if (isMounted) {
                  setResult(r => ({ ...r, state: 'ERROR', error: 'No workspace found', failedPhase: 'WORKSPACE_RESOLUTION' }));
              }
            }
          } catch (err: any) {
            if (isMounted) {
                setResult(r => ({ ...r, state: 'ERROR', error: err.message || 'Startup failed', failedPhase: result.state }));
            }
          }
      };

      await handleUser(sessionUser);

      const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
        if (!isMounted) return;
        await handleUser(session?.user || null);
      });

      // Watchdog: If still initializing/authenticating after 15s, fail
      setTimeout(() => {
        if (isMounted) {
            setResult(r => {
                if (['INITIALIZING', 'AUTHENTICATING', 'RESOLVING_ORGANIZATION', 'RESOLVING_WORKSPACE'].includes(r.state)) {
                    return { ...r, state: 'ERROR', error: 'Startup timed out', failedPhase: r.state };
                }
                return r;
            });
        }
      }, 15000);

      return () => {
        isMounted = false;
        subscription.unsubscribe();
      };
    }

    runStartup();
  }, []);

  return result;
}
