import { createContext, useContext, type ReactNode } from 'react';
import { api, type Schemas } from './api/client';
import { useResource } from './api/useResource';
import { ProblemView, Loading } from './components/States';

type Me = Schemas['Me'];
type Role = Schemas['ConsoleRole'];

const SessionContext = createContext<Me | null>(null);

/** Loads who is signed in. Roles only shape navigation; the backend enforces every check (D-003). */
export function SessionProvider({ children }: { children: ReactNode }) {
  const { state, reload } = useResource((signal) => api.GET('/api/v1/me', { signal }), []);
  if (state.kind === 'loading') return <Loading label="Opening your console session" />;
  if (state.kind === 'error') {
    return (
      <main id="main" className="page">
        <h1>box1 Operations</h1>
        <ProblemView problem={state.problem} onRetry={reload} />
      </main>
    );
  }
  return <SessionContext.Provider value={state.data}>{children}</SessionContext.Provider>;
}

export function useSession(): Me {
  const me = useContext(SessionContext);
  if (!me) throw new Error('useSession outside SessionProvider');
  return me;
}

export function useHasRole(...roles: Role[]): boolean {
  const me = useSession();
  return roles.some((r) => me.roles.includes(r));
}

export const VIEW_ROLES: Role[] = ['console-viewer', 'console-operator', 'console-developer'];
