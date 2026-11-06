import { Link } from 'react-router';

export function NotFound() {
  return (
    <div className="state" role="alert">
      <h1>Page not found</h1>
      <p><Link to="/">Go to the overview</Link></p>
    </div>
  );
}
