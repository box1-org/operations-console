import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { Layout } from './Layout';
import { SessionProvider } from './session';
import { Home } from './pages/Home';
import { Orders } from './pages/Orders';
import { PlaceOrder } from './pages/PlaceOrder';
import { OrderDetail } from './pages/OrderDetail';
import { IncidentDetail, Incidents } from './pages/Incidents';
import { Sites } from './pages/Sites';
import { Delivery } from './pages/Delivery';
import { Demo } from './pages/Demo';
import { NotFound } from './pages/NotFound';
import './styles.css';

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/orders', element: <Orders /> },
      { path: '/orders/new', element: <PlaceOrder /> },
      { path: '/orders/:orderId', element: <OrderDetail /> },
      { path: '/incidents', element: <Incidents /> },
      { path: '/incidents/:incidentId', element: <IncidentDetail /> },
      { path: '/sites', element: <Sites /> },
      { path: '/delivery', element: <Delivery /> },
      { path: '/demo', element: <Demo /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <SessionProvider>
      <RouterProvider router={router} />
    </SessionProvider>
  </StrictMode>,
);
