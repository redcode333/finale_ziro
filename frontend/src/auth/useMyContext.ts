import { useAuth } from './AuthContext'

// Contributor pages scope everything to the signed-in member. The backend enforces this again.
export function useMyContext() {
  const { me } = useAuth()
  const membership = me?.memberships.find((m) => m.status === 'ACTIVE')
  return { me, teamId: membership?.team_id ?? '', memberId: me?.member_id ?? null }
}
