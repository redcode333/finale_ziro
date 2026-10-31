import { useQuery } from '@tanstack/react-query'
import { api } from './client'

export const POLL_MS = 2000

export const useDashboard = (teamId: string) =>
  useQuery({ queryKey: ['dashboard', teamId], queryFn: () => api.dashboard(teamId), refetchInterval: POLL_MS })
