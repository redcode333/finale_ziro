import {
  Activity, BarChart3, CheckSquare, ClipboardList, FlaskConical, Flag, LayoutDashboard, ListChecks, Target, Users,
} from 'lucide-react'
import { Navigate, Route, Routes } from 'react-router-dom'
import AppShell, { type NavItem } from '@/layouts/AppShell'
import ComingSoon from '@/pages/ComingSoon'
import Denied from '@/pages/Denied'
import SignIn from '@/pages/SignIn'
import Overview from '@/pages/admin/Overview'
import { RequireRole } from '@/routes/Guards'

const adminNav: NavItem[] = [
  { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/admin/team', label: 'Team', icon: Users },
  { to: '/admin/sprint', label: 'Sprint', icon: Target },
  { to: '/admin/agent', label: 'Agent Center', icon: Activity },
  { to: '/admin/approvals', label: 'Approvals', icon: CheckSquare },
  { to: '/admin/reports', label: 'Reports', icon: BarChart3 },
  { to: '/admin/reliability', label: 'Reliability Lab', icon: FlaskConical },
]
const contributorNav: NavItem[] = [
  { to: '/contributor', label: 'My Dashboard', icon: LayoutDashboard, end: true },
  { to: '/contributor/tasks', label: 'My Tasks', icon: ListChecks },
  { to: '/contributor/standup', label: 'Daily Standup', icon: ClipboardList },
  { to: '/contributor/blockers', label: 'Blockers', icon: Flag },
]

const stub = (title: string) => <ComingSoon title={title} />

export default function App() {
  return (
    <Routes>
      <Route path="/signin" element={<SignIn />} />
      <Route path="/denied" element={<Denied />} />

      <Route element={<RequireRole role="ADMIN" />}>
        <Route path="/admin" element={<AppShell portal="Admin portal" items={adminNav} />}>
          <Route index element={<Overview />} />
          <Route path="team" element={stub('Team')} />
          <Route path="sprint" element={stub('Sprint')} />
          <Route path="agent" element={stub('Agent Center')} />
          <Route path="approvals" element={stub('Approvals')} />
          <Route path="reports" element={stub('Weekly report')} />
          <Route path="reliability" element={stub('Reliability Lab')} />
        </Route>
      </Route>

      <Route element={<RequireRole role="CONTRIBUTOR" />}>
        <Route path="/contributor" element={<AppShell portal="Contributor portal" items={contributorNav} />}>
          <Route index element={stub('My Dashboard')} />
          <Route path="tasks" element={stub('My Tasks')} />
          <Route path="standup" element={stub('Daily Standup')} />
          <Route path="blockers" element={stub('Blockers')} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/signin" replace />} />
    </Routes>
  )
}
