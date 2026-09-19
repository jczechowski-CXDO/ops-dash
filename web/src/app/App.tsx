import { Navigate, Route, Routes } from 'react-router';
import { Shell } from './Shell.js';
import { ROUTE } from './routes.js';
import Overview from '../views/Overview.js';
import ServiceDetail from '../views/ServiceDetail.js';
import IncidentDetail from '../views/IncidentDetail.js';
import Entra from '../views/Entra.js';
import Endpoints from '../views/Endpoints.js';
import Email from '../views/Email.js';
import Settings from '../views/Settings.js';

export function App() {
  return (
    <Shell>
      <Routes>
        <Route path={ROUTE.overview} element={<Overview />} />
        <Route path={ROUTE.service} element={<ServiceDetail />} />
        <Route path={ROUTE.incident} element={<IncidentDetail />} />
        <Route path={ROUTE.entra} element={<Entra />} />
        <Route path={ROUTE.endpoints} element={<Endpoints />} />
        <Route path={ROUTE.email} element={<Email />} />
        <Route path={ROUTE.settings} element={<Settings />} />
        <Route path="*" element={<Navigate to={ROUTE.overview} replace />} />
      </Routes>
    </Shell>
  );
}
