import { useState } from "react";
import { setWelcomeSeenAt, type Role } from "./api.js";
import { Queue } from "./components/Queue.js";
import { TicketView } from "./components/TicketView.js";
import { EvalReport } from "./components/EvalReport.js";
import { Documents } from "./components/Documents.js";
import { AuditTrail } from "./components/AuditTrail.js";
import { EmbeddingIndex } from "./components/EmbeddingIndex.js";
import { Admin } from "./components/Admin.js";
import { QualityDashboard } from "./components/QualityDashboard.js";
import { PlatformSupport } from "./components/PlatformSupport.js";
import { Shell, type NavItem } from "./design-system/Shell.js";
import { WelcomeBanner } from "./design-system/WelcomeBanner.js";
import { Dashboard } from "./pages/Dashboard.js";

const PLATFORM_ORG_ID = "org_default";

export interface Session {
  displayName: string;
  role: Role;
  orgId: string;
  orgName: string;
  welcomeSeenAt: string | null;
}

type View =
  | { name: "dashboard" }
  | { name: "queue" }
  | { name: "ticket"; ticketId: string }
  | { name: "eval" }
  | { name: "documents" }
  | { name: "audit" }
  | { name: "embeddings" }
  | { name: "quality" }
  | { name: "admin" }
  | { name: "platform" };

// V3-8 (LLD_v3 §6): the pre-v3 App.tsx content, unchanged in structure
// (plan: "keep the authenticated app's internal view-switching as-is") —
// just extracted so the new root App.tsx can route the public tree (/,
// /signup, /login) to it via /app/*, and to add the first-login welcome
// banner (V3-7).
export function AuthenticatedApp({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [view, setView] = useState<View>({ name: "dashboard" });
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);

  const canViewQuality = session.role === "manager" || session.role === "admin";
  // V3-6/V3-9 (LLD_v3 §4, HLD_v3 ADR-16): read-only cross-org view, only
  // meaningful for the platform operator's own org — same guard the backend
  // independently enforces on every /platform/* route.
  const canViewPlatform = session.orgId === PLATFORM_ORG_ID;

  // V2-2/V2-3 (LLD_v2 §8): "sidebar ... items filtered by role" — Quality
  // dashboard is manager+, Admin is admin-only; the backend enforces the
  // real permission checks independently either way.
  const navItems: NavItem[] = [
    {
      key: "dashboard",
      label: "Dashboard",
      active: view.name === "dashboard",
      onClick: () => setView({ name: "dashboard" }),
    },
    {
      key: "queue",
      label: "Ticket queue",
      active: view.name === "queue" || view.name === "ticket",
      onClick: () => setView({ name: "queue" }),
    },
    {
      key: "documents",
      label: "Documents",
      active: view.name === "documents",
      onClick: () => setView({ name: "documents" }),
    },
    // Eval report: restricted to org_default (canViewPlatform) — the eval
    // runner only ever operates against org_default's seeded fixtures
    // (evalRunner.ts's EVAL_ORG is hardcoded), and the backend now 403s any
    // other org's caller on every /eval-runs route (closing what used to be
    // a real cross-tenant exposure, not just a missing nav gate — see
    // evalRuns.ts's requireOrgDefault()).
    ...(canViewPlatform
      ? [
          {
            key: "eval",
            label: "Eval report",
            active: view.name === "eval",
            onClick: () => setView({ name: "eval" as const }),
          },
        ]
      : []),
    // New: audit trail (GET /agent-runs list) — same runs:view permission
    // tier as the per-run trace every ticket detail already exposes, so
    // this is available to every role that can already reach a ticket.
    {
      key: "audit",
      label: "Audit trail",
      active: view.name === "audit",
      onClick: () => setView({ name: "audit" }),
    },
    // New: RAG-pipeline visibility — the resolution-embedding index itself.
    // org_default only (canViewPlatform), same reasoning as Eval report
    // above: the backend independently 403s any other org (embeddings.ts).
    ...(canViewPlatform
      ? [
          {
            key: "embeddings",
            label: "Embeddings",
            active: view.name === "embeddings",
            onClick: () => setView({ name: "embeddings" as const }),
          },
        ]
      : []),
    ...(canViewQuality
      ? [
          {
            key: "quality",
            label: "Quality dashboard",
            active: view.name === "quality",
            onClick: () => setView({ name: "quality" as const }),
          },
        ]
      : []),
    ...(session.role === "admin"
      ? [
          {
            key: "admin",
            label: "Admin",
            active: view.name === "admin",
            onClick: () => setView({ name: "admin" as const }),
          },
        ]
      : []),
    ...(canViewPlatform
      ? [
          {
            key: "platform",
            label: "Platform support",
            active: view.name === "platform",
            onClick: () => setView({ name: "platform" as const }),
          },
        ]
      : []),
  ];

  return (
    <Shell navItems={navItems} displayName={session.displayName} orgName={session.orgName} onLogout={onLogout}>
      {!session.welcomeSeenAt && !welcomeDismissed && (
        <WelcomeBanner
          orgName={session.orgName}
          onDismiss={() => {
            setWelcomeSeenAt(new Date().toISOString());
            setWelcomeDismissed(true);
          }}
        />
      )}
      {view.name === "dashboard" && <Dashboard />}
      {view.name === "queue" && <Queue onSelect={(ticketId) => setView({ name: "ticket", ticketId })} />}
      {view.name === "ticket" && (
        <TicketView ticketId={view.ticketId} onBack={() => setView({ name: "queue" })} role={session.role} />
      )}
      {view.name === "documents" && <Documents role={session.role} />}
      {view.name === "audit" && <AuditTrail />}
      {view.name === "embeddings" && canViewPlatform && <EmbeddingIndex />}
      {view.name === "eval" && canViewPlatform && <EvalReport role={session.role} />}
      {view.name === "quality" && canViewQuality && <QualityDashboard />}
      {view.name === "admin" && session.role === "admin" && <Admin orgId={session.orgId} />}
      {view.name === "platform" && canViewPlatform && <PlatformSupport />}
    </Shell>
  );
}
