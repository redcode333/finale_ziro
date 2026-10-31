import { useAuth } from '@/auth/AuthContext'
import GithubConnectCard from '@/components/common/GithubConnectCard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function ProfileSettings() {
  const { me } = useAuth()
  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Profile and settings</h1>
        <p className="text-sm text-muted-foreground">Your profile and connected accounts.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-[100px_1fr] gap-1 text-sm">
          <span className="text-muted-foreground">Name</span><span>{me?.name}</span>
          <span className="text-muted-foreground">Email</span><span>{me?.email}</span>
          <span className="text-muted-foreground">Member ID</span><span className="font-mono">{me?.member_id}</span>
        </CardContent>
      </Card>
      <GithubConnectCard scope="me" />
    </section>
  )
}
