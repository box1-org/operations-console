import { Button } from 'react-aria-components';
import type { Problem } from '../api/client';

export function Loading({ label }: { label: string }) {
  return (
    <div className="state state-loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      {label}…
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="state state-empty" role="status">
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}

/** Typed error display. 401 means the session ended; 403 is a backend refusal, shown as a forbidden state. */
export function ProblemView({ problem, onRetry }: { problem: Problem; onRetry?: () => void }) {
  if (problem.status === 401) {
    return (
      <div className="state state-error" role="alert">
        <h2>Your console session has ended</h2>
        <p>Sign in again to continue. Nothing from your session was kept in this browser.</p>
        <p><a className="button" href="/" data-testid="sign-in-again">Sign in again</a></p>
      </div>
    );
  }
  if (problem.status === 403 && problem.code === 'ROLE_REQUIRED') {
    return <Forbidden />;
  }
  return (
    <div className="state state-error" role="alert">
      <h2>{problem.title}</h2>
      {problem.detail && <p>{problem.detail}</p>}
      <p className="meta">
        Code <code>{problem.code}</code>
        {problem.source && <> · source <code>{problem.source}</code></>}
        {problem.status > 0 && <> · HTTP {problem.status}</>}
      </p>
      {onRetry && <Button onPress={onRetry}>Retry</Button>}
    </div>
  );
}

export function Forbidden() {
  return (
    <div className="state state-forbidden" role="alert" data-testid="forbidden">
      <h2>Not available with your console roles</h2>
      <p>The console backend refused this view for your account. Ask a box1 administrator for the role you need.</p>
    </div>
  );
}
