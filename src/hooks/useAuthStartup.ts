import { useState, useEffect } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '../services/supabase';
import { initAuthListener } from '../services/auth';
import { SupabaseDataService } from '../services/supabaseDataService';
import { Organization, Workspace } from '../types';

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
}

export function useAuthStartup(): StartupResult {
  const [result, setResult] = useState<StartupResult>({
    state: 'INITIALIZING',
    user: null,
    organization: null,
    workspaces: [],
    activeWorkspace: null,
    error: null,
  });

  useEffect(() => {
    let isMounted = true;

    async function runStartup() {
      if (!isMounted) return;

      // 1. Check Supabase Client
      if (!supabase) {
        setResult(r => ({ ...r, state: 'ERROR', error: 'Database Configuration Missing' }));
        return;
      }

      setResult(r => ({ ...r, state: 'AUTHENTICATING' }));

      // 2. Auth Listener
      const unsubscribe = initAuthListener(
        async (sessionUser) => {
          if (!isMounted) return;
          
          setResult(r => ({ ...r, user: sessionUser, state: 'RESOLVING_ORGANIZATION' }));

          try {
            // 3. Resolve Organization/Onboarding
            const onboardData = await SupabaseDataService.onboardUser();
            
            if (!isMounted) return;
            setResult(r => ({ 
                ...r, 
                organization: onboardData.organization, 
                workspaces: onboardData.workspaces, 
                state: 'RESOLVING_WORKSPACE' 
            }));

            // 4. Resolve Workspace
            if (onboardData.workspaces.length > 0) {
              const ws = onboardData.workspaces[0];
              if (isMounted) {
                  setResult(r => ({ ...r, activeWorkspace: ws, state: 'READY' }));
              }
            } else {
              if (isMounted) {
                  setResult(r => ({ ...r, state: 'ERROR', error: 'No workspace found' }));
              }
            }
          } catch (err: any) {
            if (isMounted) {
                setResult(r => ({ ...r, state: 'ERROR', error: err.message || 'Onboarding failed' }));
            }
          }
        },
        () => {
          if (isMounted) {
            setResult(r => ({ ...r, user: null, state: 'UNAUTHENTICATED' }));
          }
        }
      );

      return () => {
        isMounted = false;
        unsubscribe();
      };
    }

    runStartup();
  }, []);

  return result;
}
