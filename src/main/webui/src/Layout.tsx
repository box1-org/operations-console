import { NavLink, Outlet, useLocation } from 'react-router';
import { useEffect, useRef } from 'react';
import { useHasRole, useSession, VIEW_ROLES } from './session';

/** Branded shell: skip link, role-shaped navigation (backend still enforces), focus moved to the page on navigation. */
export function Layout() {
  const me = useSession();
  const canView = useHasRole(...VIEW_ROLES);
  const isDeveloper = useHasRole('console-developer');
  const location = useLocation();
  const main = useRef<HTMLElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    main.current?.focus();
  }, [location.pathname]);

  return (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="topbar">
        <a className="brand" href="/">
          <img src="/brand/box1-mark.png" alt="" width="32" height="32" />
          <span className="brand-parent">box1</span>{' '}
          <span className="brand-product">Operations</span>
        </a>
        <span className="env" title="Environment this console serves">{me.environment}</span>
        <span className="user">
          <span className="sr-only">Signed in as </span>{me.username}
          <span className="roles">{me.roles.length ? me.roles.map((r) => r.replace('console-', '')).join(', ') : 'no console role'}</span>
        </span>
        <a className="signout" href="/logout">Sign out</a>
      </header>
      <nav className="nav" aria-label="Console">
        <ul>
          {canView && <li><NavLink to="/" end>Home</NavLink></li>}
          {canView && <li><NavLink to="/orders">Orders</NavLink></li>}
          {canView && <li><NavLink to="/incidents">Incidents</NavLink></li>}
          {canView && <li><NavLink to="/sites">Sites &amp; assets</NavLink></li>}
          {isDeveloper && <li><NavLink to="/delivery">Delivery</NavLink></li>}
          {canView && <li><NavLink to="/demo">Demo control</NavLink></li>}
        </ul>
      </nav>
      <main id="main" ref={main} tabIndex={-1} className="page">
        <Outlet />
      </main>
    </div>
  );
}
