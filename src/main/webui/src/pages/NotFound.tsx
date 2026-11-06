import { Link } from 'react-router';

export function NotFound() {
  return (
    <div className="state">
      <title>Not found · box1 Operations</title>
      <h1>Page not found</h1>
      <p><Link to="/">Go to the overview</Link></p>
    </div>
  );
}
