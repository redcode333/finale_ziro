import {
  Activity, BarChart3, CheckSquare, ClipboardList, FlaskConical, Flag, GitPullRequest, Plug, Settings, LayoutDashboard, ListChecks, Target, Users,
} from 'lucide-react'
import { Navigate, Route, Routes } from 'react-router-dom'
import AppShell, { type NavItem } from '@/layouts/AppShell'
import Denied from '@/pages/Denied'
import MockGithubConsent from '@/pages/MockGithubConsent'
import SignIn from '@/pages/SignIn'
import Integrations from '@/pages/admin/Integrations'
import ProfileSettings from '@/pages/contributor/ProfileSettings'
import Approvals from '@/pages/admin/Approvals'
import Blockers from '@/pages/contributor/Blockers'
import DailyStandup from '@/pages/contributor/DailyStandup'
import MyContributions from '@/pages/contributor/MyContributions'
import MyDashboard from '@/pages/contributor/MyDashboard'
import MyTasks from '@/pages/contributor/MyTasks'
import SprintManagement from '@/pages/admin/SprintManagement'
import TeamManagement from '@/pages/admin/TeamManagement'
import Overview from '@/pages/admin/Overview'
import ReliabilityLab from '@/pages/admin/ReliabilityLab'
import Reports from '@/pages/admin/Reports'
import AgentCenter from '@/pages/admin/agent/AgentCenter'
import { RequireRole } from '@/routes/Guards'

const adminNav: NavItem[] = [
  { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/admin/team', label: 'Team', icon: Users },
  { to: '/admin/sprint', label: 'Sprint', icon: Target },
  { to: '/admin/agent', label: 'Agent Center', icon: Activity },
  { to: '/admin/approvals', label: 'Approvals', icon: CheckSquare },
  { to: '/admin/reports', label: 'Reports', icon: BarChart3 },
  { to: '/admin/integrations', label: 'Integrations', icon: Plug },
  { to: '/admin/reliability', label: 'Reliability Lab', icon: FlaskConical },
]
const contributorNav: NavItem[] = [
  { to: '/contributor', label: 'My Dashboard', icon: LayoutDashboard, end: true },
  { to: '/contributor/tasks', label: 'My Tasks', icon: ListChecks },
  { to: '/contributor/standup', label: 'Daily Standup', icon: ClipboardList },
  { to: '/contributor/contributions', label: 'My Contributions', icon: GitPullRequest },
  { to: '/contributor/blockers', label: 'Blockers', icon: Flag },
  { to: '/contributor/settings', label: 'Profile & Settings', icon: Settings },
]


export default function App() {
  return (
    <Routes>
      <Route path="/signin" element={<SignIn />} />
      <Route path="/denied" element={<Denied />} />
      {import.meta.env.VITE_USE_MOCKS === 'true' && <Route path="/mock/github-consent" element={<MockGithubConsent />} />}

      <Route element={<RequireRole role="ADMIN" />}>
        <Route path="/admin" element={<AppShell portal="Admin portal" items={adminNav} githubScope="project" settingsPath="/admin/integrations" />}>
          <Route index element={<Overview />} />
          <Route path="team" element={<TeamManagement />} />
          <Route path="sprint" element={<SprintManagement />} />
          <Route path="agent" element={<AgentCenter />} />
          <Route path="approvals" element={<Approvals />} />
          <Route path="reports" element={<Reports />} />
          <Route path="integrations" element={<Integrations />} />
          <Route path="reliability" element={<ReliabilityLab />} />
        </Route>
      </Route>

      <Route element={<RequireRole role="CONTRIBUTOR" />}>
        <Route path="/contributor" element={<AppShell portal="Contributor portal" items={contributorNav} githubScope="me" settingsPath="/contributor/settings" />}>
          <Route index element={<MyDashboard />} />
          <Route path="tasks" element={<MyTasks />} />
          <Route path="standup" element={<DailyStandup />} />
          <Route path="contributions" element={<MyContributions />} />
          <Route path="blockers" element={<Blockers />} />
          <Route path="settings" element={<ProfileSettings />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/signin" replace />} />
    </Routes>
  )
}
