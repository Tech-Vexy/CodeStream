import { Dashboard } from './pages/Dashboard';
import { Landing } from './pages/Landing';

/**
 * The server routes "/" (landing) and "/app" (dashboard) to this bundle, matching the
 * previous static-pages behavior. In-app navigation inside the dashboard uses hash
 * routes (#/new, #/casts/:id) so deep links keep working behind the Hono server.
 */
export function App() {
  if (location.pathname === '/app' || location.pathname.startsWith('/app/')) {
    return <Dashboard />;
  }
  return <Landing />;
}
