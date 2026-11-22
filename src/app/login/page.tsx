// Login page: one button that starts the Keycloak SSO flow. Demo accounts are listed for visitors.
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  expired: "The sign-in took too long. Please try again.",
  callback: "Sign-in failed. Please try again.",
  no_role: "Your account has no role in this app (sales-manager or viewer).",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="mx-auto mt-10 max-w-md space-y-5">
      <div className="card space-y-4 p-6 text-center">
        <h1 className="text-xl font-semibold">Sign in</h1>
        <p className="text-sm text-[var(--muted)]">
          The dashboard uses single sign-on with Keycloak (OpenID Connect, PKCE). Roles come from the identity provider.
        </p>
        {error && <p className="text-sm text-[var(--bad)]">{ERRORS[error] ?? "Sign-in error."}</p>}
        <a href="/api/auth/login" className="btn inline-block px-5 py-2">
          Sign in with SSO
        </a>
      </div>
      <div className="card text-sm">
        <p className="font-medium">Demo accounts</p>
        <table className="mt-2 w-full text-left">
          <tbody>
            <tr><td className="py-1 font-mono">manager / manager</td><td className="text-[var(--muted)]">runs agents, approves proposals</td></tr>
            <tr><td className="py-1 font-mono">viewer / viewer</td><td className="text-[var(--muted)]">read-only</td></tr>
          </tbody>
        </table>
        {config.demoMode && (
          <p className="mt-3 text-xs text-[var(--muted)]">
            Public demo with sample data about a fictional company. The sandbox resets every night
            {config.dailyRunLimit ? `; up to ${config.dailyRunLimit} agent runs per day` : ""}. Nothing leaves the sandbox: replies go to a
            fake outbox.
          </p>
        )}
      </div>
    </div>
  );
}
