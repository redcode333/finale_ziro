import { LogOut, type LucideIcon } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface NavItem { to: string; label: string; icon: LucideIcon; end?: boolean }

// Shared by the Admin and Contributor portals: same visual language, different navigation.
export default function AppShell({ portal, items }: { portal: string; items: NavItem[] }) {
  const { me, signOut } = useAuth()
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-3 md:flex">
        <div className="px-2 py-3">
          <p className="font-mono text-sm text-primary">FairSprint AI</p>
          <p className="text-xs text-muted-foreground">{portal}</p>
        </div>
        <nav aria-label={`${portal} navigation`} className="mt-2 flex flex-1 flex-col gap-1">
          {items.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors duration-150 hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  isActive && 'bg-sidebar-accent text-foreground',
                )
              }
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-sidebar-border pt-3">
          <p className="truncate px-2 text-sm">{me?.name}</p>
          <Button variant="ghost" size="sm" className="mt-1 w-full justify-start" onClick={signOut}>
            <LogOut aria-hidden /> Sign out
          </Button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 items-center justify-between border-b border-border px-4">
          <span className="text-sm text-muted-foreground">CampusConnect · Sprint 1 – Core MVP</span>
          <Badge variant="outline" title="All records are fictional demo data">Synthetic data</Badge>
        </header>
        <main className="flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
