/* eslint-disable react-hooks/purity */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { CAMPAIGN_OBJECTIVES } from "@/lib/campaign-objectives";
import { VOICE_STACKS } from "@/lib/provider-stacks";

type IconName =
  | "overview"
  | "prospects"
  | "campaigns"
  | "calls"
  | "calendar"
  | "agent"
  | "shield"
  | "plug"
  | "upload"
  | "phone"
  | "arrow"
  | "check"
  | "clock"
  | "block"
  | "settings"
  | "refresh"
  | "download"
  | "close";

type NavItem = { id: string; label: string; icon: IconName };
type CredentialProvider = "twilio" | "telnyx" | "openai" | "elevenlabs" | "gemini" | "calcom";
type CallingLimits = { providerConcurrent: number; providerCps: number; planConcurrent: number; effectiveConcurrent: number; effectiveCps: number; maxAiCallSeconds: number };

type DashboardData = {
  viewer: { userId: string; displayName: string; email: string; role: string; platformRole: "user" | "super_admin"; permissions: string[] };
  workspace: { id: string; name: string; planKey: string; plan: { name: string; priceMonthly: number; seats: number; prospects: number; campaigns: number; concurrentCalls: number; callsPerMonth: number; workspaceIntegrations: number }; subscriptionStatus: string; trialEndsAt: number | null; billingOverrideType: "none" | "complimentary" | "discount"; billingDiscountPercent: number; billingOverrideStartsAt: number | null; billingOverrideEndsAt: number | null; memberCount: number; stripeConfigured: boolean; hasBillingAccount: boolean; currentPeriodEnd: number | null; usage: { callsStarted: number; contactsImported: number; callMinutes: number; aiTurns: number } };
  metrics: { eligible: number; blocked: number; active: number; booked: number };
  readiness: Record<"voiceStack" | "calendar" | "eligibleProspects" | "baseUrl" | "complianceGate", boolean>;
  readinessPassed: number;
  leads: Array<{
    id: string;
    createdByUserId: string | null;
    firstName: string;
    lastName: string;
    company: string | null;
    title: string | null;
    phoneE164: string;
    email: string | null;
    timezone: string | null;
    consentStatus: string;
    dncCheckedAt: number | null;
    status: string;
    crmStage: "new" | "attempted" | "connected" | "qualified" | "appointment_set" | "nurturing" | "won" | "lost" | "do_not_contact";
    nextFollowUpAt: number | null;
    dealValueCents: number;
    notes: string | null;
    blockReasons: string[];
    createdAt: number;
    outreachCount: number;
    lastOutreachAt: number | null;
  }>;
  campaigns: Array<{
    id: string;
    name: string;
    sellerName: string;
    productName: string;
    agentName: string;
    productSummary: string;
    objective: string;
    telephonyProvider: "twilio" | "telnyx";
    aiProvider: "openai" | "elevenlabs" | "gemini";
    voiceStackKey: string;
    voiceStackLabel: string;
    voiceStackMaturity: string;
    providerReady: boolean;
    status: string;
    maxConcurrent: number;
    callsPerSecond: number;
    meetingDurationMinutes: number;
    queue: Record<string, number>;
    createdAt: number;
  }>;
  calls: Array<{
    id: string;
    twilioCallSid: string | null;
    providerCallId: string | null;
    telephonyProvider: "twilio" | "telnyx";
    aiProvider: "openai" | "elevenlabs" | "gemini";
    status: string;
    outcome: string | null;
    startedAt: number | null;
    endedAt: number | null;
    durationSeconds: number | null;
    summary: string | null;
    firstName: string;
    lastName: string;
    company: string | null;
  }>;
  appointments: Array<{
    id: string;
    subject: string;
    startAt: number;
    endAt: number;
    timezone: string;
    attendeeEmail: string;
    joinUrl: string | null;
    status: string;
    firstName: string;
    lastName: string;
    company: string | null;
  }>;
  crmTasks: Array<{ id: string; leadId: string; title: string; dueAt: number | null; status: "open" | "completed" | "cancelled"; createdAt: number }>;
  auditEvents: Array<{
    id: string;
    actor: string;
    eventType: string;
    entityType: string | null;
    details: Record<string, unknown>;
    createdAt: number;
  }>;
  integrations: {
    calendar: { connected: boolean; provider: string | null; accountEmail: string | null };
    outlook: { connected: boolean; accountEmail: string | null };
    google: { connected: boolean; accountEmail: string | null };
    connections: Array<{ id: string; provider: string; category: string; scope: string; label: string; accountIdentifier: string | null; status: string; ownerUserId: string | null }>;
    voiceStacks: Array<{ key: string; label: string; telephonyProvider: "twilio" | "telnyx"; aiProvider: "openai" | "elevenlabs" | "gemini"; maturity: string; description: string; configured: boolean; limits: CallingLimits | null }>;
    twilio: { configured: boolean; callingLimits: CallingLimits };
    telnyx: { configured: boolean };
    openai: { configured: boolean; model: string };
    elevenlabs: { configured: boolean; agent: string };
    gemini: { configured: boolean; model: string };
    appBaseUrl: { configured: boolean };
  };
};

type Toast = { tone: "success" | "error" | "info"; message: string };

const primaryNav: NavItem[] = [
  { id: "overview", label: "Overview", icon: "overview" },
  { id: "prospects", label: "CRM", icon: "prospects" },
  { id: "campaigns", label: "Campaigns", icon: "campaigns" },
  { id: "calls", label: "Calls", icon: "calls" },
  { id: "appointments", label: "Appointments", icon: "calendar" },
];

const systemNav: NavItem[] = [
  { id: "agent", label: "Agent studio", icon: "agent" },
  { id: "compliance", label: "Compliance", icon: "shield" },
  { id: "integrations", label: "Integrations", icon: "plug" },
  { id: "team", label: "Team & roles", icon: "prospects" },
  { id: "billing", label: "Billing & plans", icon: "settings" },
  { id: "platform-admin", label: "Platform admin", icon: "shield" },
];

const sectionTitles: Record<string, { eyebrow: string; title: string; subtitle: string }> = {
  overview: {
    eyebrow: "Campaign control",
    title: "Calling operations",
    subtitle: "A protected workspace for consented outreach and Outlook scheduling.",
  },
  prospects: {
    eyebrow: "Customer relationship management",
    title: "CRM",
    subtitle: "Move prospects from first outreach to booked meeting without leaving the dialer.",
  },
  campaigns: {
    eyebrow: "Outbound programs",
    title: "Campaigns",
    subtitle: "Run controlled queues with explicit launch attestations.",
  },
  calls: {
    eyebrow: "Conversation ledger",
    title: "Calls",
    subtitle: "Monitor outcomes, summaries, provider status, and opt-outs.",
  },
  appointments: {
    eyebrow: "Outlook calendar",
    title: "Appointments",
    subtitle: "Meetings created only after a prospect confirms the time and email.",
  },
  agent: {
    eyebrow: "Conversation design",
    title: "Agent studio",
    subtitle: "Review the identity, product brief, and server-enforced tool limits.",
  },
  compliance: {
    eyebrow: "Policy center",
    title: "Compliance",
    subtitle: "Consent, suppression, local-time, and audit controls stay visible.",
  },
  integrations: {
    eyebrow: "System connections",
    title: "Integrations",
    subtitle: "Connect your own calling, AI, and calendar providers securely.",
  },
  team: {
    eyebrow: "Access control",
    title: "Team & roles",
    subtitle: "Manage workspace seats with least-privilege role assignments.",
  },
  billing: {
    eyebrow: "Subscription",
    title: "Billing & plans",
    subtitle: "Choose limits that match your calling volume and team size.",
  },
  "platform-admin": {
    eyebrow: "Application administration",
    title: "Platform admin",
    subtitle: "Manage every customer workspace, plan, and account status.",
  },
};

export default function DialerDashboard({
  userName,
  userEmail,
}: {
  userName: string;
  userEmail: string;
}) {
  const [activeSection, setActiveSection] = useState("overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [campaignModal, setCampaignModal] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [complianceAttested, setComplianceAttested] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const navigation = useMemo(() => [...primaryNav, ...systemNav.filter((item) => item.id !== "platform-admin" || data?.viewer.platformRole === "super_admin")], [data?.viewer.platformRole]);
  const heading = sectionTitles[activeSection] ?? sectionTitles.overview;
  const activeLabel = navigation.find((item) => item.id === activeSection)?.label ?? "Overview";

  const loadDashboard = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      const payload = (await response.json()) as DashboardData & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not load the dashboard.");
      setData(payload);
    } catch (error) {
      setToast({ tone: "error", message: errorMessage(error) });
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => {
      void loadDashboard();
      const params = new URLSearchParams(window.location.search);
      const requestedSection = params.get("section");
      if (requestedSection && sectionTitles[requestedSection]) setActiveSection(requestedSection);
      if (params.get("outlook") === "connected") {
        setToast({ tone: "success", message: "Outlook connected successfully." });
        window.history.replaceState({}, "", "/app");
      } else if (params.get("google") === "connected") {
        setToast({ tone: "success", message: "Google Calendar connected successfully." });
        window.history.replaceState({}, "", "/app");
      } else if (params.get("outlook_error")) {
        setToast({ tone: "error", message: params.get("outlook_error") || "Outlook connection failed." });
        window.history.replaceState({}, "", "/app");
      }
    }, 0);
    const timer = window.setInterval(() => void loadDashboard(true), 10_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [loadDashboard]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 6_000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function selectSection(id: string) {
    setActiveSection(id);
    setMenuOpen(false);
    setProfileOpen(false);
    const url = new URL(window.location.href);
    url.searchParams.set("section", id);
    window.history.replaceState({}, "", `${url.pathname}?${url.searchParams.toString()}`);
  }

  async function importFile(file: File) {
    setBusy("import");
    try {
      const rows = await workbookRows(file);
      const response = await fetch("/api/leads/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rows, sourceFile: file.name }),
      });
      const result = (await response.json()) as {
        error?: string;
        inserted?: number;
        eligible?: number;
        blocked?: number;
        duplicates?: number;
        rejected?: unknown[];
      };
      if (!response.ok) throw new Error(result.error || "Import failed.");
      setToast({
        tone: "success",
        message: `${result.inserted} imported: ${result.eligible} eligible, ${result.blocked} safely blocked, ${result.duplicates} duplicates skipped.`,
      });
      await loadDashboard(true);
      selectSection("prospects");
    } catch (error) {
      setToast({ tone: "error", message: errorMessage(error) });
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function createCampaign(form: HTMLFormElement) {
    setBusy("campaign-create");
    try {
      const values = new FormData(form);
      const response = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: values.get("name"),
          sellerName: values.get("sellerName"),
          productName: values.get("productName"),
          agentName: values.get("agentName"),
          productSummary: values.get("productSummary"),
          objective: values.get("objective"),
          voiceStack: values.get("voiceStack"),
          meetingDurationMinutes: Number(values.get("meetingDurationMinutes")),
        }),
      });
      const result = (await response.json()) as { error?: string; queued?: number };
      if (!response.ok) throw new Error(result.error || "Campaign creation failed.");
      setCampaignModal(false);
      setToast({ tone: "success", message: `Campaign created with ${result.queued} eligible prospects queued.` });
      await loadDashboard(true);
    } catch (error) {
      setToast({ tone: "error", message: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  }

  async function launchCampaign(id: string) {
    setBusy(`launch:${id}`);
    try {
      const response = await fetch(`/api/campaigns/${encodeURIComponent(id)}/launch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ complianceAttested }),
      });
      const result = (await response.json()) as {
        error?: string;
        launched?: number;
        blocked?: number;
        skippedOutsideWindow?: number;
      };
      if (!response.ok) throw new Error(result.error || "Campaign launch failed.");
      setToast({
        tone: result.launched ? "success" : "info",
        message: result.launched
          ? `${result.launched} calls entered the selected voice provider. ${result.blocked} were blocked; ${result.skippedOutsideWindow} are waiting for local hours.`
          : "No calls launched. Eligible prospects may be outside their local calling window.",
      });
      setComplianceAttested(false);
      await loadDashboard(true);
    } catch (error) {
      setToast({ tone: "error", message: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  }

  async function disconnectOutlookAccount() {
    if (!window.confirm("Disconnect Outlook and remove the stored OAuth tokens?")) return;
    setBusy("outlook-disconnect");
    try {
      const response = await fetch("/api/outlook/disconnect", { method: "POST" });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not disconnect Outlook.");
      setToast({ tone: "success", message: "Outlook disconnected." });
      await loadDashboard(true);
    } catch (error) {
      setToast({ tone: "error", message: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  }

  const displayName = data?.viewer.displayName || userName;
  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "DM";

  return (
    <div className="app-shell">
      <input
        ref={fileInput}
        type="file"
        accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
        className="visually-hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importFile(file);
        }}
      />
      <aside className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}>
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            <span className="brand-ring" />
            <span className="brand-core" />
          </div>
          <div>
            <div className="brand-name">APPOINTMENT SETTER</div>
            <div className="brand-subtitle">AI CALLING CONTROL ROOM</div>
          </div>
        </div>
        <nav className="navigation" aria-label="Primary navigation">
          <div className="nav-label">Workspace</div>
          {primaryNav.map((item) => (
            <NavButton key={item.id} item={item} active={activeSection === item.id} onClick={() => selectSection(item.id)} />
          ))}
          <div className="nav-label nav-label-spaced">System</div>
          {systemNav.filter((item) => item.id !== "platform-admin" || data?.viewer.platformRole === "super_admin").map((item) => (
            <NavButton key={item.id} item={item} active={activeSection === item.id} onClick={() => selectSection(item.id)} count={item.id === "compliance" ? data?.metrics.blocked : undefined} />
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="safety-status">
            <span className="safety-pulse" />
            <div>
              <strong>Compliance gate active</strong>
              <span>{data?.metrics.active ? `${data.metrics.active} live calls` : "No live calls"}</span>
            </div>
          </div>
          <button className="profile-button" type="button" aria-expanded={profileOpen} aria-haspopup="menu" onClick={() => setProfileOpen((value) => !value)}>
            <span className="profile-avatar">{initials}</span>
            <span className="profile-copy">
              <strong>{displayName}</strong>
              <span title={userEmail}>{data?.viewer.platformRole === "super_admin" ? "Platform Super Admin" : humanize(data?.viewer.role || "member")} · {data?.workspace.plan.name || "Trial"}</span>
            </span>
            <Icon name="settings" size={17} />
          </button>
          {profileOpen ? <div className="profile-menu" role="menu"><div><strong>{displayName}</strong><span>{userEmail}</span></div><button role="menuitem" onClick={() => selectSection("overview")}>My workspace</button><button role="menuitem" onClick={() => selectSection("billing")}>Billing & plan</button>{data?.viewer.platformRole === "super_admin" ? <button role="menuitem" onClick={() => selectSection("platform-admin")}><Icon name="shield" size={15} />Platform administration</button> : null}<Link role="menuitem" href="/">Public website</Link><a role="menuitem" className="profile-signout" href="/signout-with-chatgpt?return_to=/">Sign out</a></div> : null}
        </div>
      </aside>
      {menuOpen ? <button className="sidebar-scrim" type="button" aria-label="Close navigation" onClick={() => setMenuOpen(false)} /> : null}

      <main className="main-content">
        <header className="topbar">
          <button className="mobile-menu" type="button" aria-label="Open navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}>
            <span /><span /><span />
          </button>
          <div className="mobile-title">{activeLabel}</div>
          <div className="topbar-actions">
            <div className="readiness-chip">
              <span /> Launch readiness: {data?.readinessPassed ?? 0} of 5
            </div>
            <button className="icon-button" type="button" aria-label="Refresh data" onClick={() => void loadDashboard()} disabled={loading}>
              <Icon name="refresh" size={17} />
            </button>
            <button className="button button-secondary" type="button" onClick={() => fileInput.current?.click()} disabled={busy === "import"}>
              <Icon name="upload" size={17} />
              {busy === "import" ? "Importing…" : "Import prospects"}
            </button>
          </div>
        </header>

        <div className="content-wrap">
          <section className="page-heading">
            <div>
              <div className="eyebrow">{heading.eyebrow}</div>
              <h1>{activeSection === "overview" ? `Good ${dayPart()}, ${firstName(displayName)}` : heading.title}</h1>
              <p>{heading.subtitle}</p>
            </div>
            <div className="page-date"><Icon name="clock" size={17} />Live operations</div>
          </section>

          {loading && !data ? (
            <section className="panel loading-panel"><span className="loading-spinner" /><strong>Loading the protected workspace…</strong></section>
          ) : (
            <DashboardSection
              section={activeSection}
              data={data}
              busy={busy}
              complianceAttested={complianceAttested}
              setComplianceAttested={setComplianceAttested}
              onNavigate={selectSection}
              onImport={() => fileInput.current?.click()}
              onNewCampaign={() => setCampaignModal(true)}
              onLaunch={(id) => void launchCampaign(id)}
              onDisconnectOutlook={() => void disconnectOutlookAccount()}
              onRefresh={() => void loadDashboard(true)}
            />
          )}
        </div>
      </main>

      {campaignModal ? (
        <CampaignModal
          busy={busy === "campaign-create"}
          data={data}
          onClose={() => setCampaignModal(false)}
          onSubmit={(form) => void createCampaign(form)}
        />
      ) : null}
      {toast ? <div className={`toast toast-${toast.tone}`} role="status"><span>{toast.tone === "success" ? "✓" : toast.tone === "error" ? "!" : "i"}</span>{toast.message}<button type="button" aria-label="Dismiss" onClick={() => setToast(null)}><Icon name="close" size={15} /></button></div> : null}
    </div>
  );
}

function DashboardSection(props: {
  section: string;
  data: DashboardData | null;
  busy: string | null;
  complianceAttested: boolean;
  setComplianceAttested: (value: boolean) => void;
  onNavigate: (id: string) => void;
  onImport: () => void;
  onNewCampaign: () => void;
  onLaunch: (id: string) => void;
  onDisconnectOutlook: () => void;
  onRefresh: () => void;
}) {
  const data = props.data;
  if (!data) return null;
  if (props.section === "overview") return <Overview data={data} onNavigate={props.onNavigate} onImport={props.onImport} />;
  if (props.section === "prospects") return <Prospects data={data} onImport={props.onImport} busy={props.busy === "import"} onRefresh={props.onRefresh} />;
  if (props.section === "campaigns") {
    return (
      <CampaignsView
        data={data}
        busy={props.busy}
        attested={props.complianceAttested}
        setAttested={props.setComplianceAttested}
        onCreate={props.onNewCampaign}
        onLaunch={props.onLaunch}
      />
    );
  }
  if (props.section === "calls") return <CallsView data={data} />;
  if (props.section === "appointments") return <AppointmentsView data={data} onConnect={() => props.onNavigate("integrations")} />;
  if (props.section === "agent") return <AgentView data={data} />;
  if (props.section === "compliance") return <ComplianceView data={data} />;
  if (props.section === "integrations") return <IntegrationsView data={data} onDisconnectOutlook={props.onDisconnectOutlook} busy={props.busy} onRefresh={props.onRefresh} />;
  if (props.section === "team") return <TeamView data={data} />;
  if (props.section === "platform-admin") return <PlatformAdminView data={data} />;
  return <BillingView data={data} />;
}

function Overview({ data, onNavigate, onImport }: { data: DashboardData; onNavigate: (id: string) => void; onImport: () => void }) {
  const campaign = data.campaigns[0];
  const activeLimit = campaign?.maxConcurrent ?? data.integrations.voiceStacks.find((stack) => stack.configured)?.limits?.effectiveConcurrent ?? data.integrations.twilio.callingLimits.effectiveConcurrent;
  const metrics = [
    { label: "Eligible prospects", value: data.metrics.eligible, detail: "Written consent verified", icon: "prospects" as IconName, tone: "cyan" },
    { label: "Live sessions", value: `${data.metrics.active} / ${activeLimit}`, detail: `${data.workspace.plan.name} + provider effective limit`, icon: "phone" as IconName, tone: "blue" },
    { label: "Meetings booked", value: data.metrics.booked, detail: "Confirmed in Outlook", icon: "calendar" as IconName, tone: "green" },
    { label: "Compliance blocked", value: data.metrics.blocked, detail: "Never sent to dialer", icon: "block" as IconName, tone: "amber" },
  ];
  return (
    <>
      <section className="metric-grid" aria-label="Campaign metrics">
        {metrics.map((metric) => (
          <article className="metric-card" key={metric.label}>
            <div className={`metric-icon metric-icon-${metric.tone}`}><Icon name={metric.icon} size={19} /></div>
            <div className="metric-label">{metric.label}</div><div className="metric-value">{metric.value}</div><div className="metric-detail">{metric.detail}</div>
          </article>
        ))}
      </section>
      <section className="overview-grid">
        <article className="panel campaign-panel">
          <div className="panel-header"><div><span className="panel-kicker">Next campaign</span><h2>{campaign?.name || "No campaign created"}</h2></div><StatusBadge value={campaign?.status || "draft"} /></div>
          <div className="campaign-summary">
            <div className="campaign-ring" aria-label={`Launch readiness ${data.readinessPassed} of 5`}><div><strong>{data.readinessPassed}/5</strong><span>ready</span></div></div>
            <div className="campaign-details">
              <DetailRow label="Eligible queue" value={`${campaign?.queue.queued ?? 0} prospects`} />
              <DetailRow label="Maximum live calls" value={`${campaign?.maxConcurrent ?? 20} concurrent`} />
              <DetailRow label="Calling window" value="9:00 AM–4:30 PM local" />
            </div>
          </div>
          <div className="guardrail-strip"><Icon name="shield" size={18} /><div><strong>Launch is protected</strong><span>Every lead is revalidated immediately before the selected telephony provider receives the number.</span></div></div>
          <div className="panel-actions"><button className="button button-secondary" type="button" onClick={() => onNavigate("campaigns")}>Review campaign</button><button className="button button-primary" type="button" onClick={() => onNavigate("campaigns")}><Icon name="phone" size={17} />Launch controls</button></div>
        </article>
        <article className="panel setup-panel">
          <div className="panel-header compact"><div><span className="panel-kicker">Production setup</span><h2>Required connections</h2></div><button className="text-button" type="button" onClick={() => onNavigate("integrations")}>View all <Icon name="arrow" size={15} /></button></div>
          <div className="integration-list">
            <IntegrationRow icon="calendar" name="Microsoft Outlook" description={data.integrations.outlook.accountEmail || "Calendar availability and Teams invitations"} ready={data.integrations.outlook.connected} />
            <IntegrationRow icon="phone" name={campaign?.voiceStackLabel || "Voice provider stack"} description={campaign ? `${campaign.voiceStackMaturity} · campaign selection` : "Choose Twilio + OpenAI or a Telnyx stack"} ready={campaign?.providerReady ?? data.integrations.voiceStacks.some((stack) => stack.configured)} />
            <IntegrationRow icon="agent" name="Server-controlled agent tools" description="Qualification, opt-out, and signed calendar actions" ready />
          </div>
          <div className="verified-control"><span className="control-check"><Icon name="check" size={13} /></span><div><strong>Compliance gate installed</strong><span>Unverified contacts cannot enter a calling queue.</span></div></div>
        </article>
      </section>
      <section className="panel activity-panel">
        <div className="panel-header compact"><div><span className="panel-kicker">Operational feed</span><h2>Recent activity</h2></div><button className="text-button" type="button" onClick={() => onNavigate("compliance")}>Audit log <Icon name="arrow" size={15} /></button></div>
        {data.auditEvents.length ? <AuditList events={data.auditEvents.slice(0, 5)} /> : <EmptyState icon="calls" title="No calls yet" copy="Import consented prospects and complete your connections to begin." action="Import Excel sheet" onAction={onImport} />}
      </section>
    </>
  );
}

const CRM_STAGES = ["new", "attempted", "connected", "qualified", "appointment_set", "nurturing", "won", "lost", "do_not_contact"] as const;

function Prospects({ data, onImport, busy, onRefresh }: { data: DashboardData; onImport: () => void; busy: boolean; onRefresh: () => void }) {
  const [guideOpen, setGuideOpen] = useState(false);
  const [historyLead, setHistoryLead] = useState<DashboardData["leads"][number] | null>(null);
  const [selectedLead, setSelectedLead] = useState<DashboardData["leads"][number] | null>(data.leads[0] ?? null);
  const [view, setView] = useState<"contacts" | "pipeline" | "tasks" | "companies">("contacts");
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const canWrite = data.viewer.permissions.includes("prospects:write");
  const filtered = data.leads.filter((lead) => `${lead.firstName} ${lead.lastName} ${lead.company || ""} ${lead.title || ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  const companies = Array.from(new Set(filtered.map((lead) => lead.company).filter(Boolean))).map((company) => ({ name: company as string, prospects: filtered.filter((lead) => lead.company === company) }));
  const pipelineValue = data.leads.reduce((sum, lead) => sum + lead.dealValueCents, 0);

  async function updateStage(lead: DashboardData["leads"][number], crmStage: string) {
    setSaving(`stage:${lead.id}`);
    const response = await fetch(`/api/prospects/${lead.id}/crm`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ crmStage }) });
    setSaving(null); if (response.ok) onRefresh();
  }
  async function addTask(form: HTMLFormElement) {
    setSaving("task:new"); const values = new FormData(form); const due = values.get("dueAt");
    const response = await fetch("/api/crm/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ leadId: values.get("leadId"), title: values.get("title"), dueAt: due ? new Date(String(due)).getTime() : null }) });
    setSaving(null); if (response.ok) { form.reset(); onRefresh(); }
  }
  async function toggleTask(id: string, completed: boolean) {
    setSaving(`task:${id}`); const response = await fetch("/api/crm/tasks", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, status: completed ? "completed" : "open" }) });
    setSaving(null); if (response.ok) onRefresh();
  }

  return <>
    <section className="crm-summary-grid">
      <article className="panel crm-summary"><span>New prospects</span><strong>{data.leads.filter((lead) => lead.crmStage === "new").length}</strong><small>Ready for first touch</small></article>
      <article className="panel crm-summary"><span>Connected</span><strong>{data.leads.filter((lead) => ["connected", "qualified", "appointment_set"].includes(lead.crmStage)).length}</strong><small>Live conversations</small></article>
      <article className="panel crm-summary"><span>Qualified</span><strong>{data.leads.filter((lead) => lead.crmStage === "qualified").length}</strong><small>Sales-ready prospects</small></article>
      <article className="panel crm-summary"><span>Pipeline value</span><strong>{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(pipelineValue / 100)}</strong><small>Open tracked value</small></article>
    </section>
    <section className="panel section-panel table-panel">
      <div className="section-toolbar"><div><span className="panel-kicker">Dialer-connected CRM · {data.leads.length} of {data.workspace.plan.prospects.toLocaleString()} plan capacity</span><h2>Prospects, pipeline, tasks, and companies</h2></div><div className="toolbar-actions"><button className="button button-secondary" type="button" onClick={() => setGuideOpen(true)}>Import guide</button><button className="button button-primary" type="button" onClick={onImport} disabled={busy}><Icon name="upload" size={17}/>{busy ? "Importing…" : "Import Excel or CSV"}</button></div></div>
      <div className="crm-controls"><div className="crm-tabs" role="tablist">{(["contacts", "pipeline", "tasks", "companies"] as const).map((item) => <button key={item} className={view === item ? "active" : ""} type="button" onClick={() => setView(item)}>{humanize(item)}</button>)}</div><label className="crm-search"><span className="visually-hidden">Search CRM</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search prospects or companies…"/></label></div>
      {!data.leads.length ? <div className="import-zone" onClick={onImport} role="button" tabIndex={0}><div className="import-graphic"><Icon name="upload" size={27}/></div><h2>Bring in your prospect workbook</h2><p>Every imported prospect becomes a CRM record while consent and DNC controls still determine whether the dialer may call.</p></div> : null}
      {data.leads.length && view === "contacts" ? <><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Prospect</th><th>CRM stage</th><th>Dialer eligibility</th><th>Last outreach</th><th>Next follow-up</th><th>Owner</th></tr></thead><tbody>{filtered.map((lead) => <tr key={lead.id} className={selectedLead?.id === lead.id ? "crm-selected-row" : ""} onClick={() => setSelectedLead(lead)}><td><strong>{lead.firstName} {lead.lastName}</strong><span>{[lead.title, lead.company].filter(Boolean).join(" · ") || "—"}</span></td><td><select className="crm-stage-select" aria-label={`CRM stage for ${lead.firstName} ${lead.lastName}`} value={lead.crmStage} disabled={!canWrite || saving === `stage:${lead.id}`} onClick={(event) => event.stopPropagation()} onChange={(event) => void updateStage(lead, event.target.value)}>{CRM_STAGES.map((stage) => <option value={stage} key={stage}>{humanize(stage)}</option>)}</select></td><td><StatusBadge value={lead.status} title={lead.blockReasons.map(humanize).join(", ")}/></td><td><button className="text-button" type="button" onClick={(event) => { event.stopPropagation(); setHistoryLead(lead); }}>{lead.outreachCount} attempt{lead.outreachCount === 1 ? "" : "s"}{lead.lastOutreachAt ? ` · ${formatDate(lead.lastOutreachAt, { month: "short", day: "numeric" })}` : ""}</button></td><td>{lead.nextFollowUpAt ? formatDate(lead.nextFollowUpAt, { month: "short", day: "numeric", hour: "numeric" }) : "Not scheduled"}</td><td>{lead.createdByUserId === data.viewer.userId ? "You" : "Workspace"}</td></tr>)}</tbody></table></div>{selectedLead ? <div className="crm-record-strip"><div><span>Selected prospect</span><strong>{selectedLead.firstName} {selectedLead.lastName}</strong><small>{selectedLead.company || "Independent"}</small></div><div><span>Contact</span><strong>{selectedLead.phoneE164}</strong><small>{selectedLead.email || "No booking email"}</small></div><div><span>Compliance</span><strong>{humanize(selectedLead.consentStatus)}</strong><small>{selectedLead.dncCheckedAt ? `DNC checked ${formatDate(selectedLead.dncCheckedAt, { month: "short", day: "numeric" })}` : "DNC check missing"}</small></div><div><span>Next action</span><strong>{selectedLead.nextFollowUpAt ? formatDate(selectedLead.nextFollowUpAt, { month: "short", day: "numeric", hour: "numeric" }) : "Create a follow-up task"}</strong><button className="text-button" type="button" onClick={() => setHistoryLead(selectedLead)}>Open complete timeline</button></div></div> : null}</> : null}
      {data.leads.length && view === "pipeline" ? <div className="crm-pipeline">{CRM_STAGES.slice(0, 7).map((stage) => { const stageLeads = filtered.filter((lead) => lead.crmStage === stage); return <section className="crm-column" key={stage}><header><span>{humanize(stage)}</span><strong>{stageLeads.length}</strong></header>{stageLeads.map((lead) => <button type="button" className="crm-deal-card" key={lead.id} onClick={() => { setSelectedLead(lead); setView("contacts"); }}><strong>{lead.firstName} {lead.lastName}</strong><span>{lead.company || "Independent"}</span><small>{lead.outreachCount} outreach attempt{lead.outreachCount === 1 ? "" : "s"}</small></button>)}{!stageLeads.length ? <p>No prospects</p> : null}</section>; })}</div> : null}
      {data.leads.length && view === "tasks" ? <div className="crm-tasks"><form className="inline-form crm-task-form" onSubmit={(event) => { event.preventDefault(); void addTask(event.currentTarget); }}><select name="leadId" required defaultValue=""><option value="" disabled>Choose prospect</option>{data.leads.map((lead) => <option key={lead.id} value={lead.id}>{lead.firstName} {lead.lastName}</option>)}</select><input name="title" placeholder="Follow-up task" required/><input name="dueAt" type="datetime-local"/><button className="button button-primary" disabled={!canWrite || saving === "task:new"}>{saving === "task:new" ? "Saving…" : "Add task"}</button></form><div className="crm-task-list">{data.crmTasks.length ? data.crmTasks.map((task) => { const lead = data.leads.find((item) => item.id === task.leadId); return <label className={`crm-task ${task.status === "completed" ? "done" : ""}`} key={task.id}><input type="checkbox" checked={task.status === "completed"} disabled={!canWrite || saving === `task:${task.id}`} onChange={(event) => void toggleTask(task.id, event.target.checked)}/><span><strong>{task.title}</strong><small>{lead ? `${lead.firstName} ${lead.lastName}` : "Prospect"} · {task.dueAt ? formatDate(task.dueAt, { month: "short", day: "numeric", hour: "numeric" }) : "No due date"}</small></span></label>; }) : <div className="focused-empty compact"><h2>No follow-up tasks</h2><p>Create the next action for a prospect above.</p></div>}</div></div> : null}
      {data.leads.length && view === "companies" ? <div className="crm-company-grid">{companies.length ? companies.map((company) => <article className="crm-company" key={company.name}><div><span className="panel-kicker">Company</span><h3>{company.name}</h3></div><strong>{company.prospects.length}</strong><small>{company.prospects.filter((lead) => ["qualified", "appointment_set"].includes(lead.crmStage)).length} sales-ready</small></article>) : <div className="focused-empty compact"><h2>No company records</h2><p>Add company values during import to group prospects automatically.</p></div>}</div> : null}
      <div className="policy-footnote"><Icon name="shield" size={17}/><span>CRM stage never overrides calling consent. Every attempt still passes the dialer’s consent, DNC, timezone, and plan-limit controls.</span></div>
    </section>
    {guideOpen ? <ImportGuideModal onClose={() => setGuideOpen(false)}/> : null}
    {historyLead ? <OutreachHistoryModal lead={historyLead} canWrite={canWrite} onClose={() => setHistoryLead(null)}/> : null}
  </>;
}

const IMPORT_FIELDS = [
  ["first_name / last_name", "Recommended", "Prospect name."], ["company / title", "Optional", "Employer and role."], ["phone", "Required", "E.164 (+13375551234) or a 10-digit US number."], ["email", "To book", "Required before sending a calendar invitation."], ["timezone", "Required to call", "IANA value such as America/Chicago."], ["consent_status", "Required to call", "Use express_written; vague yes values are blocked."], ["consent_timestamp", "Required to call", "Date/time consent was captured."], ["consent_source", "Required to call", "Form, campaign, agreement, or other capture source."], ["consent_evidence", "Required to call", "Durable evidence ID or reference."], ["dnc_checked_at", "Required to call", "DNC screening date; must be within 31 days."], ["internal_dnc", "Required", "false to allow evaluation; true always blocks."], ["notes", "Optional", "Internal context for the team."],
];
function ImportGuideModal({ onClose }: { onClose: () => void }) { return <div className="modal-backdrop"><section className="modal modal-wide" role="dialog" aria-modal="true"><div className="modal-header"><div><span className="panel-kicker">Excel and CSV format</span><h2>Prospect import guide</h2></div><button className="icon-button" onClick={onClose}><Icon name="close" /></button></div><p className="muted-copy">Use one prospect per row. Keep the exact header names below in row 1. Download the template, open it in Excel, fill the rows, save as .xlsx or .csv, and upload it here.</p><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Column</th><th>Requirement</th><th>What to enter</th></tr></thead><tbody>{IMPORT_FIELDS.map(([field, requirement, description]) => <tr key={field}><td><strong>{field}</strong></td><td>{requirement}</td><td>{description}</td></tr>)}</tbody></table></div><div className="modal-actions"><a className="button button-secondary" href="/api/leads/template"><Icon name="download" />Download blank template</a><button className="button button-primary" onClick={onClose}>Got it</button></div></section></div>; }

function OutreachHistoryModal({ lead, canWrite, onClose }: { lead: DashboardData["leads"][number]; canWrite: boolean; onClose: () => void }) { const [events, setEvents] = useState<Array<{ id: string; channel: string; status: string; outcome: string | null; notes: string | null; actor: string; occurredAt: number }>>([]); const [error, setError] = useState(""); const load = useCallback(async () => { const response = await fetch(`/api/prospects/${lead.id}/outreach`); const payload = await response.json() as { events?: typeof events; error?: string }; if (response.ok) setEvents(payload.events || []); else setError(payload.error || "Could not load history."); }, [lead.id]); useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]); async function add(form: HTMLFormElement) { const values = new FormData(form); const response = await fetch(`/api/prospects/${lead.id}/outreach`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel: values.get("channel"), outcome: values.get("outcome"), notes: values.get("notes") }) }); const payload = await response.json() as { error?: string }; if (!response.ok) return setError(payload.error || "Could not add entry."); form.reset(); void load(); } return <div className="modal-backdrop"><section className="modal modal-wide" role="dialog" aria-modal="true"><div className="modal-header"><div><span className="panel-kicker">Permanent contact ledger</span><h2>{lead.firstName} {lead.lastName}</h2></div><button className="icon-button" onClick={onClose}><Icon name="close" /></button></div>{canWrite ? <form className="inline-form outreach-form" onSubmit={(event) => { event.preventDefault(); void add(event.currentTarget); }}><select name="channel" defaultValue="phone"><option value="phone">Phone</option><option value="email">Email</option><option value="sms">SMS</option><option value="manual">Other</option></select><input name="outcome" placeholder="Outcome (left voicemail)" required /><input name="notes" placeholder="Optional notes" /><button className="button button-primary">Add entry</button></form> : null}{error ? <p className="legal-note">{error}</p> : null}<div className="data-table-wrap"><table className="data-table"><thead><tr><th>When</th><th>Channel</th><th>Status / outcome</th><th>Recorded by</th><th>Notes</th></tr></thead><tbody>{events.length ? events.map((event) => <tr key={event.id}><td>{formatDate(event.occurredAt, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</td><td>{humanize(event.channel)}</td><td><strong>{humanize(event.outcome || event.status)}</strong></td><td>{event.actor}</td><td>{event.notes || "—"}</td></tr>) : <tr><td colSpan={5}>No outreach has been recorded yet.</td></tr>}</tbody></table></div></section></div>; }

function CampaignsView({ data, busy, attested, setAttested, onCreate, onLaunch }: { data: DashboardData; busy: string | null; attested: boolean; setAttested: (value: boolean) => void; onCreate: () => void; onLaunch: (id: string) => void }) {
  return (
    <>
      <section className="panel launch-checklist">
        <div className="panel-header compact"><div><span className="panel-kicker">Five-part launch gate</span><h2>{data.readinessPassed} of 5 controls passed</h2></div><button className="button button-primary" type="button" onClick={onCreate}>New campaign</button></div>
        <div className="readiness-grid">{Object.entries(data.readiness).map(([key, ready]) => <div className={`readiness-item ${ready ? "ready" : "not-ready"}`} key={key}><span>{ready ? <Icon name="check" size={13} /> : "!"}</span><div><strong>{readinessLabel(key)}</strong><small>{ready ? "Passed" : "Action required"}</small></div></div>)}</div>
        <label className={`attestation ${attested ? "attestation-checked" : ""}`}><input type="checkbox" checked={attested} onChange={(event) => setAttested(event.target.checked)} /><span className="custom-checkbox"><Icon name="check" size={13} /></span><span>I attest that every queued prospect has documented prior express written consent for this seller, the DNC check is current, and the uploaded evidence is accurate.</span></label>
      </section>
      <section className="campaign-card-grid">
        {data.campaigns.length ? data.campaigns.map((campaign) => {
          const queued = campaign.queue.queued ?? 0;
          const launching = busy === `launch:${campaign.id}`;
          const allReady = campaign.providerReady && data.readiness.calendar && data.readiness.eligibleProspects && data.readiness.baseUrl && data.readiness.complianceGate;
          return <article className="panel campaign-list-card" key={campaign.id}><div className="panel-header compact"><div><span className="panel-kicker">{campaign.sellerName} · {campaign.productName}</span><h2>{campaign.name}</h2><small>{campaign.voiceStackLabel} · {campaign.voiceStackMaturity}</small></div><StatusBadge value={campaign.status} /></div><p>{campaign.productSummary}</p><div className="campaign-stat-row"><div><span>Queued</span><strong>{queued}</strong></div><div><span>Effective concurrency</span><strong>{campaign.maxConcurrent}</strong></div><div><span>Provider CPS</span><strong>{campaign.callsPerSecond}</strong></div><div><span>Appointment</span><strong>{campaign.meetingDurationMinutes} min</strong></div></div><div className="panel-actions"><span className="launch-note">{campaign.providerReady ? campaign.objective : `Connect ${campaign.telephonyProvider} and ${campaign.aiProvider} before launch`} · calling begins only during each prospect’s local window.</span><button className="button button-primary" type="button" disabled={!allReady || !attested || queued === 0 || launching} onClick={() => onLaunch(campaign.id)}><Icon name="phone" size={17} />{launching ? "Launching…" : "Start protected calling"}</button></div></article>;
        }) : <section className="panel focused-empty"><div className="focused-icon"><Icon name="campaigns" size={30} /></div><h2>Create your first protected campaign</h2><p>Every currently eligible prospect will be added to its controlled queue. Review the product brief before launch.</p><button className="button button-primary" type="button" onClick={onCreate}>New campaign <Icon name="arrow" size={15} /></button></section>}
      </section>
    </>
  );
}

function CallsView({ data }: { data: DashboardData }) {
  if (!data.calls.length) return <section className="panel focused-empty"><div className="focused-icon"><Icon name="calls" size={30} /></div><h2>Every call leaves an audit trail</h2><p>Provider status, transcript-derived outcomes, summaries, opt-outs, and appointment links will appear here.</p></section>;
  return <section className="panel section-panel table-panel"><div className="section-toolbar"><div><span className="panel-kicker">Provider and agent ledger</span><h2>{data.calls.length} recent calls</h2></div><span className="live-refresh"><i />Updates every 10 seconds</span></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Prospect</th><th>Voice stack</th><th>Status</th><th>Outcome</th><th>Started</th><th>Duration</th><th>Summary</th></tr></thead><tbody>{data.calls.map((call) => <tr key={call.id}><td><strong>{call.firstName} {call.lastName}</strong><span>{call.company || call.providerCallId || call.twilioCallSid || "—"}</span></td><td>{humanize(call.telephonyProvider)} + {humanize(call.aiProvider)}</td><td><StatusBadge value={call.status} /></td><td>{humanize(call.outcome || "pending")}</td><td>{call.startedAt ? formatDate(call.startedAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"}</td><td>{formatDuration(call.durationSeconds)}</td><td className="summary-cell">{call.summary || "—"}</td></tr>)}</tbody></table></div></section>;
}

function AppointmentsView({ data, onConnect }: { data: DashboardData; onConnect: () => void }) {
  if (!data.integrations.calendar.connected) return <section className="panel focused-empty"><div className="focused-icon"><Icon name="calendar" size={30} /></div><h2>Connect a calendar</h2><p>Connect Outlook or Google Calendar so the agent can read availability and create invitations.</p><button className="button button-primary" type="button" onClick={onConnect}>Choose calendar <Icon name="arrow" size={15} /></button></section>;
  if (!data.appointments.length) return <section className="panel focused-empty"><div className="focused-icon"><Icon name="calendar" size={30} /></div><h2>Outlook is ready</h2><p>Confirmed meetings will appear here with their source prospect and Teams link.</p></section>;
  return <section className="panel section-panel table-panel"><div className="section-toolbar"><div><span className="panel-kicker">Microsoft Graph events</span><h2>{data.appointments.length} appointments</h2></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Prospect</th><th>When</th><th>Email</th><th>Status</th><th>Meeting</th></tr></thead><tbody>{data.appointments.map((appointment) => <tr key={appointment.id}><td><strong>{appointment.firstName} {appointment.lastName}</strong><span>{appointment.company || appointment.subject}</span></td><td><strong>{formatDate(appointment.startAt, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: appointment.timezone })}</strong><span>{appointment.timezone}</span></td><td>{appointment.attendeeEmail}</td><td><StatusBadge value={appointment.status} /></td><td>{appointment.joinUrl ? <a className="table-link" href={appointment.joinUrl} target="_blank" rel="noreferrer">Open Teams <Icon name="arrow" size={13} /></a> : "Outlook event"}</td></tr>)}</tbody></table></div></section>;
}

function AgentView({ data }: { data: DashboardData }) {
  return <section className="agent-grid"><article className="panel agent-identity"><div className="agent-orb"><span /><span /><span /></div><div><span className="panel-kicker">Campaign identity</span><h2>Provider-neutral qualification agent</h2><p>Each campaign defines its seller, product, factual brief, agent name, and voice stack while preserving truthful AI disclosure.</p></div><div className="connection-state connected"><span />{data.integrations.voiceStacks.filter((stack) => stack.configured).length} stacks ready</div></article><article className="panel"><div className="panel-header compact"><div><span className="panel-kicker">Mandatory opening</span><h2>Disclosure before dialogue</h2></div><Icon name="shield" size={22} /></div><blockquote>“I’m [agent], an AI assistant calling on behalf of [seller]. This is a sales call about [product]…”</blockquote><p className="muted-copy">The provider adapter injects the campaign-specific disclosure and records it before qualification begins.</p></article><article className="panel tool-policy"><span className="panel-kicker">Approved actions</span><h2>Small, auditable tool surface</h2><div className="tool-list"><ToolRow icon="calendar" title="Read Outlook availability" copy="Returns up to three free local-time slots with signed tokens." /><ToolRow icon="check" title="Create one appointment" copy="Requires an exact tokenized slot, valid email, and explicit confirmation." /><ToolRow icon="block" title="Enforce opt-out" copy="Immediately suppresses the lead outside model discretion." /></div></article><article className="panel tool-policy"><span className="panel-kicker">Never permitted</span><h2>Hard boundaries</h2><div className="boundary-list"><span>Impersonate a human</span><span>Invent price or product claims</span><span>Call an unverified prospect</span><span>Book without confirmation</span><span>Continue after an opt-out</span></div></article></section>;
}

function ComplianceView({ data }: { data: DashboardData }) {
  const rules = [
    ["Prior express written consent", "Status, timestamp, source, and evidence are all required."],
    ["DNC freshness", "A dated screening record must be no more than 31 days old."],
    ["Local calling hours", "Weekdays from 9:00 AM to 4:30 PM in the prospect’s IANA timezone."],
    ["Internal suppression", "A spoken opt-out immediately revokes consent and blocks future calls."],
    ["AI disclosure", "Every supported voice stack identifies the assistant as AI before qualification begins."],
  ];
  return <section className="compliance-layout"><article className="panel"><div className="panel-header compact"><div><span className="panel-kicker">Server-enforced rules</span><h2>Calling policy</h2></div><span className="status-badge status-eligible">Active</span></div><div className="rule-list">{rules.map(([title, copy]) => <div className="rule-row" key={title}><span className="control-check"><Icon name="check" size={13} /></span><div><strong>{title}</strong><span>{copy}</span></div></div>)}</div><div className="legal-note"><Icon name="shield" size={18} /><p>This software provides technical safeguards, not legal advice. The operator remains responsible for jurisdiction-specific telemarketing, recording, caller-ID, licensing, and industry rules.</p></div></article><article className="panel audit-panel"><div className="panel-header compact"><div><span className="panel-kicker">Append-only events</span><h2>Audit log</h2></div><span className="live-refresh"><i />Live</span></div>{data.auditEvents.length ? <AuditList events={data.auditEvents} /> : <div className="compact-empty">No audit events yet.</div>}</article></section>;
}

function IntegrationsView({ data, onDisconnectOutlook, busy, onRefresh }: { data: DashboardData; onDisconnectOutlook: () => void; busy: string | null; onRefresh: () => void }) {
  const [provider, setProvider] = useState<CredentialProvider | null>(null);
  const [saving, setSaving] = useState(false);
  const canWorkspace = data.viewer.permissions.includes("integrations:workspace");
  async function save(form: HTMLFormElement) { setSaving(true); try { const values = new FormData(form); const config: Record<string, string> = {}; values.forEach((value, key) => { if (key !== "label") config[key] = String(value); }); const response = await fetch("/api/integrations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider, scope: provider === "calcom" ? "personal" : "workspace", label: values.get("label"), config }) }); const payload = await response.json() as { error?: string }; if (!response.ok) throw new Error(payload.error || "Could not save integration."); setProvider(null); onRefresh(); } catch (error) { window.alert(errorMessage(error)); } finally { setSaving(false); } }
  async function remove(id: string) { if (!window.confirm("Remove this integration and its encrypted credentials?")) return; const response = await fetch(`/api/integrations?id=${encodeURIComponent(id)}`, { method: "DELETE" }); const payload = await response.json() as { error?: string }; if (!response.ok) return window.alert(payload.error || "Could not remove integration."); onRefresh(); }
  const connected = (name: string) => data.integrations.connections.find((item) => item.provider === name);
  return <><section className="integration-card-grid">
    <IntegrationCard icon="calendar" name="Microsoft Outlook" description="Personal availability, Outlook events, and Teams links" ready={data.integrations.outlook.connected} detail={data.integrations.outlook.accountEmail || "Delegated Microsoft OAuth"} action={data.integrations.outlook.connected ? <button className="button button-secondary" type="button" onClick={onDisconnectOutlook} disabled={busy === "outlook-disconnect"}>{busy === "outlook-disconnect" ? "Disconnecting…" : "Disconnect"}</button> : <a className="button button-primary" href="/api/outlook/connect">Connect Outlook</a>} />
    <IntegrationCard icon="calendar" name="Google Calendar" description="Personal availability, Google events, and Meet links" ready={data.integrations.google.connected} detail={data.integrations.google.accountEmail || "Google OAuth web-server flow"} action={data.integrations.google.connected ? <span className="config-locked">Connected to this user</span> : <a className="button button-primary" href="/api/google/connect">Connect Google</a>} />
    <IntegrationCard icon="phone" name="Twilio Voice" description="Workspace outbound calling and signed callbacks" ready={data.integrations.twilio.configured} detail={data.integrations.twilio.configured ? `${data.integrations.twilio.callingLimits.providerConcurrent} ConversationRelay sessions · ${data.integrations.twilio.callingLimits.providerCps} CPS` : "Bring your own Twilio account"} action={canWorkspace ? <button className="button button-secondary" onClick={() => setProvider("twilio")}>Add or replace</button> : undefined} />
    <IntegrationCard icon="phone" name="Telnyx Voice" description="Workspace SIP or bidirectional media calling with signed webhooks" ready={data.integrations.telnyx.configured} detail={connected("telnyx")?.accountIdentifier || "Voice API connection, number, CPS, and concurrency"} action={canWorkspace ? <button className="button button-secondary" onClick={() => setProvider("telnyx")}>Add or replace</button> : undefined} />
    <IntegrationCard icon="agent" name="OpenAI" description="Workspace conversation intelligence" ready={data.integrations.openai.configured} detail={data.integrations.openai.model} action={canWorkspace ? <button className="button button-secondary" onClick={() => setProvider("openai")}>Add or replace</button> : undefined} />
    <IntegrationCard icon="agent" name="ElevenLabs Agents" description="Natural voice agent over a Telnyx SIP trunk" ready={data.integrations.elevenlabs.configured} detail={data.integrations.elevenlabs.agent} action={canWorkspace ? <button className="button button-secondary" onClick={() => setProvider("elevenlabs")}>Add or replace</button> : undefined} />
    <IntegrationCard icon="agent" name="Gemini Live" description="Preview direct speech-to-speech agent over Telnyx media streaming" ready={data.integrations.gemini.configured} detail={data.integrations.gemini.model} action={canWorkspace ? <button className="button button-secondary" onClick={() => setProvider("gemini")}>Add or replace</button> : undefined} />
    <IntegrationCard icon="calendar" name="Cal.com" description="Personal hosted booking fallback" ready={Boolean(connected("calcom"))} detail={connected("calcom")?.accountIdentifier || "API key and HTTPS booking URL"} action={<button className="button button-secondary" onClick={() => setProvider("calcom")}>Connect Cal.com</button>} />
    <IntegrationCard icon="shield" name="Encrypted credential vault" description="Secrets are encrypted at rest and never returned to the browser" ready={data.integrations.appBaseUrl.configured} detail={`${data.integrations.connections.length} visible connection${data.integrations.connections.length === 1 ? "" : "s"}`} />
  </section>{data.integrations.connections.length ? <section className="panel section-panel table-panel"><div className="section-toolbar"><div><span className="panel-kicker">Connected accounts</span><h2>Saved integrations</h2></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Provider</th><th>Label</th><th>Scope</th><th>Account</th><th /></tr></thead><tbody>{data.integrations.connections.map((item) => <tr key={item.id}><td><strong>{humanize(item.provider)}</strong></td><td>{item.label}</td><td><StatusBadge value={item.scope} /></td><td>{item.accountIdentifier || "Connected"}</td><td><button className="text-button" onClick={() => void remove(item.id)}>Remove</button></td></tr>)}</tbody></table></div></section> : null}
  {provider ? <CredentialModal provider={provider} saving={saving} onClose={() => setProvider(null)} onSubmit={save} /> : null}</>;
}

function CredentialModal({ provider, saving, onClose, onSubmit }: { provider: CredentialProvider; saving: boolean; onClose: () => void; onSubmit: (form: HTMLFormElement) => void }) {
  return <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true"><div className="modal-header"><div><span className="panel-kicker">Encrypted connection</span><h2>Connect {humanize(provider)}</h2></div><button className="icon-button" onClick={onClose}><Icon name="close" /></button></div><form onSubmit={(event) => { event.preventDefault(); onSubmit(event.currentTarget); }}><label className="form-field"><span>Connection label</span><input name="label" required defaultValue={`My ${humanize(provider)}`} /></label><CredentialFields provider={provider} /><div className="modal-note"><Icon name="shield" /><span>Credentials are verified server-side before encrypted storage. Provider and subscription limits are both enforced.</span></div><div className="modal-actions"><button className="button button-secondary" type="button" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? "Verifying…" : "Verify and connect"}</button></div></form></section></div>;
}

function CredentialFields({ provider }: { provider: CredentialProvider }) {
  if (provider === "twilio") return <><label className="form-field"><span>Account SID</span><input name="accountSid" required autoComplete="off" /></label><label className="form-field"><span>Auth token</span><input name="authToken" type="password" required autoComplete="new-password" /></label><label className="form-field"><span>From number</span><input name="fromNumber" required placeholder="+15551234567" /></label><ProviderLimitFields maxCps={5} concurrencyLabel="ConversationRelay session allowance" /><small>Use limits approved for this Twilio account; campaigns apply the lower provider, AI, and subscription allowance.</small></>;
  if (provider === "telnyx") return <><label className="form-field"><span>API key</span><input name="apiKey" type="password" required autoComplete="new-password" /></label><label className="form-field"><span>Voice API connection ID</span><input name="connectionId" required autoComplete="off" /></label><label className="form-field"><span>From number</span><input name="fromNumber" required placeholder="+15551234567" /></label><ProviderLimitFields maxCps={10} concurrencyLabel="Approved concurrent calls" /><small>The webhook public key is retrieved from Telnyx during verification and stored encrypted.</small></>;
  if (provider === "openai") return <><label className="form-field"><span>API key</span><input name="apiKey" type="password" required autoComplete="new-password" /></label><label className="form-field"><span>Model</span><select name="model" defaultValue="gpt-5.6-terra"><option value="gpt-5.6-terra">GPT-5.6 Terra</option><option value="gpt-5.6-luna">GPT-5.6 Luna</option><option value="gpt-5.5">GPT-5.5</option></select></label></>;
  if (provider === "elevenlabs") return <><label className="form-field"><span>API key</span><input name="apiKey" type="password" required autoComplete="new-password" /></label><label className="form-field"><span>Agent ID</span><input name="agentId" required /></label><label className="form-field"><span>Telnyx SIP phone number ID</span><input name="agentPhoneNumberId" required /></label><label className="form-field"><span>Post-call webhook HMAC secret</span><input name="webhookSecret" type="password" required autoComplete="new-password" /></label><label className="form-field"><span>Agent concurrency allowance</span><input name="maxConcurrentCalls" type="number" min={1} max={20} defaultValue={1} /></label><small>Configure the signed post-call webhook and server tools in ElevenLabs using this app’s callback URLs.</small></>;
  if (provider === "gemini") return <><label className="form-field"><span>Gemini API key</span><input name="apiKey" type="password" required autoComplete="new-password" /></label><label className="form-field"><span>Live model</span><input name="model" required defaultValue="gemini-3.1-flash-live-preview" /></label><label className="form-field"><span>Voice</span><select name="voice" defaultValue="Kore"><option value="Kore">Kore</option><option value="Aoede">Aoede</option><option value="Charon">Charon</option><option value="Fenrir">Fenrir</option><option value="Puck">Puck</option></select></label><small>Gemini Live is a preview stack; validate latency, regional availability, and audio quality before customer traffic.</small></>;
  return <><label className="form-field"><span>API key</span><input name="apiKey" type="password" required /></label><label className="form-field"><span>Booking URL</span><input name="bookingUrl" type="url" required placeholder="https://cal.com/you/discovery" /></label></>;
}

function ProviderLimitFields({ maxCps, concurrencyLabel }: { maxCps: number; concurrencyLabel: string }) {
  return <div className="form-grid"><label className="form-field"><span>Approved outbound CPS</span><input name="callsPerSecond" type="number" min={1} max={maxCps} defaultValue={1} /></label><label className="form-field"><span>{concurrencyLabel}</span><input name="maxConcurrentCalls" type="number" min={1} max={20} defaultValue={1} /></label></div>;
}

function TeamView({ data }: { data: DashboardData }) {
  const [members, setMembers] = useState<Array<{ userId: string; displayName: string; email: string; role: string; status: string }>>([]); const [roles, setRoles] = useState<string[]>([]); const [error, setError] = useState(""); const canManage = data.viewer.permissions.includes("members:manage");
  const load = useCallback(async () => { if (!canManage) return; const response = await fetch("/api/team"); const payload = await response.json() as { members?: typeof members; manageableRoles?: string[]; error?: string }; if (response.ok) { setMembers(payload.members || []); setRoles(payload.manageableRoles || []); } else setError(payload.error || "Could not load team."); }, [canManage]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  async function invite(form: HTMLFormElement) { const values = new FormData(form); const response = await fetch("/api/team", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: values.get("email"), role: values.get("role") }) }); const payload = await response.json() as { error?: string }; if (!response.ok) return setError(payload.error || "Could not add member."); form.reset(); setError(""); void load(); }
  async function update(userId: string, body: Record<string, unknown>) { const response = await fetch("/api/team", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId, ...body }) }); const payload = await response.json() as { error?: string }; if (!response.ok) return setError(payload.error || "Could not update member."); setError(""); void load(); }
  async function remove(userId: string) { if (!window.confirm("Remove this person from the workspace? Their historical activity remains in the audit log.")) return; const response = await fetch(`/api/team?userId=${encodeURIComponent(userId)}`, { method: "DELETE" }); const payload = await response.json() as { error?: string }; if (!response.ok) return setError(payload.error || "Could not remove member."); void load(); }
  if (!canManage) return <section className="panel focused-empty"><Icon name="shield" size={30} /><h2>Team management access required</h2><p>Owners and admins manage their lower roles; managers can manage members and viewers.</p></section>;
  return <section className="panel section-panel table-panel"><div className="section-toolbar"><div><span className="panel-kicker">Signed in as {data.viewer.platformRole === "super_admin" ? "Platform Super Admin" : humanize(data.viewer.role)} · {data.workspace.memberCount} of {data.workspace.plan.seats} seats</span><h2>{data.workspace.name}</h2></div></div><div className="role-explainer"><span><strong>Owner</strong> Billing, admins, ownership</span><span><strong>Admin</strong> Managers and team operations</span><span><strong>Manager</strong> Members and viewers</span><span><strong>Member</strong> Campaign preparation</span><span><strong>Viewer</strong> Read only</span></div><form className="inline-form" onSubmit={(event) => { event.preventDefault(); void invite(event.currentTarget); }}><input name="email" type="email" required placeholder="teammate@company.com" /><select name="role" defaultValue={roles.includes("member") ? "member" : roles[0]}>{roles.map((role) => <option value={role} key={role}>{humanize(role)}</option>)}</select><button className="button button-primary">Add member</button></form>{error ? <p className="legal-note">{error}</p> : null}<div className="data-table-wrap"><table className="data-table"><thead><tr><th>Member</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead><tbody>{members.map((member) => { const isSelf = member.userId === data.viewer.userId; const manageable = !isSelf && member.role !== "owner" && roles.some((role) => role === member.role || roleRank(role) >= roleRank(member.role)); return <tr key={member.userId}><td><strong>{member.displayName}{isSelf ? " (you)" : ""}</strong><span>{member.email}</span></td><td>{manageable ? <select value={member.role} onChange={(event) => void update(member.userId, { role: event.target.value })}>{roles.map((role) => <option value={role} key={role}>{humanize(role)}</option>)}</select> : humanize(member.role)}</td><td><StatusBadge value={member.status} /></td><td><div className="table-actions">{manageable ? <><button className="text-button" onClick={() => void update(member.userId, { status: member.status === "active" ? "disabled" : "active" })}>{member.status === "active" ? "Disable" : "Reactivate"}</button><button className="text-button danger" onClick={() => void remove(member.userId)}>Remove</button>{data.viewer.role === "owner" ? <button className="text-button" onClick={() => { if (window.confirm("Transfer workspace ownership? You will become an admin.")) void update(member.userId, { transferOwnership: true }); }}>Make owner</button> : null}</> : <span>Protected</span>}</div></td></tr>; })}</tbody></table></div></section>;
}

function BillingView({ data }: { data: DashboardData }) {
  const [now] = useState(() => Date.now());
  const plans = [{ key: "starter", name: "Starter", price: 49, detail: "1,000 prospects · 3 campaigns · 250 submitted calls/month · 1 seat · 2 concurrent · 3 integrations · 30-day audit" }, { key: "growth", name: "Growth", price: 149, detail: "5,000 prospects · 20 campaigns · 2,000 submitted calls/month · 5 seats · 10 concurrent · 10 integrations · 180-day audit" }, { key: "pro", name: "Pro", price: 399, detail: "25,000 prospects · 100 campaigns · 10,000 submitted calls/month · 20 seats · 20 concurrent · 50 integrations · 365-day audit" }];
  async function billing(path: "checkout" | "portal", plan?: string) { const response = await fetch(`/api/billing/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(plan ? { plan } : {}) }); const payload = await response.json() as { url?: string; error?: string }; if (!response.ok || !payload.url) return window.alert(payload.error || "Billing is not available."); window.location.href = payload.url; }
  const grantActive = data.workspace.billingOverrideType !== "none" && (!data.workspace.billingOverrideStartsAt || data.workspace.billingOverrideStartsAt <= now) && (!data.workspace.billingOverrideEndsAt || data.workspace.billingOverrideEndsAt > now);
  const grantLabel = data.workspace.billingOverrideType === "complimentary" ? "Complimentary platform access" : `${data.workspace.billingDiscountPercent}% platform discount`;
  return <><section className="panel section-panel"><div className="panel-header"><div><span className="panel-kicker">Current subscription</span><h2>{data.workspace.plan.name} · {humanize(data.workspace.subscriptionStatus)}</h2></div>{data.workspace.hasBillingAccount ? <button className="button button-secondary" onClick={() => void billing("portal")}>Manage billing</button> : null}</div>{grantActive ? <div className="admin-grant-banner"><Icon name="shield" /><div><strong>{grantLabel}</strong><span>{data.workspace.billingOverrideEndsAt ? `Valid through ${formatDate(data.workspace.billingOverrideEndsAt, { month: "short", day: "numeric", year: "numeric" })}` : "No expiration"}</span></div></div> : null}<div className="campaign-details"><DetailRow label="Calls this month" value={`${data.workspace.usage.callsStarted.toLocaleString()} / ${data.workspace.plan.callsPerMonth.toLocaleString()}`} /><DetailRow label="Team seats" value={`${data.workspace.memberCount} / ${data.workspace.plan.seats}`} /><DetailRow label="Concurrent calls" value={String(data.workspace.plan.concurrentCalls)} /></div></section><section className="integration-card-grid">{plans.map((plan) => { const price = grantActive && data.workspace.billingOverrideType === "discount" ? plan.price * (1 - data.workspace.billingDiscountPercent / 100) : plan.price; return <article className="panel integration-card" key={plan.key}><span className="panel-kicker">Monthly platform fee</span><h2>{plan.name}</h2><div className="metric-value">{grantActive && data.workspace.billingOverrideType === "complimentary" && data.workspace.planKey === plan.key ? "$0" : `$${price.toFixed(2)}`}</div><p>{plan.detail}</p><button className="button button-primary" disabled={!data.viewer.permissions.includes("billing:manage") || !data.workspace.stripeConfigured || data.workspace.planKey === plan.key} onClick={() => void billing("checkout", plan.key)}>{data.workspace.planKey === plan.key ? "Current plan" : "Choose plan"}</button></article>; })}</section><section className="legal-note"><Icon name="shield" /><p>Subscription prices cover this platform. Connected telephony and AI providers bill their usage directly. Calls count toward the plan only after successful provider submission.</p></section>{!data.workspace.stripeConfigured ? <section className="legal-note"><Icon name="shield" /><p>Stripe price IDs and webhook signing must be configured by the deployer before paid checkout is enabled.</p></section> : null}</>;
}

function PlatformAdminView({ data }: { data: DashboardData }) {
  type Workspace = { id: string; name: string; ownerEmail: string | null; status: string; planKey: string; subscriptionStatus: string; billingOverrideType: "none" | "complimentary" | "discount"; billingDiscountPercent: number; billingOverrideStartsAt: number | null; billingOverrideEndsAt: number | null; billingOverrideNote: string | null; memberCount: number; callCount: number; usage: { callsStarted: number; contactsImported: number }; createdAt: number };
  type PlatformUser = { id: string; email: string; displayName: string; platformRole: "user" | "super_admin"; status: string; lastSeenAt: number; organizationId: string | null; organizationName: string | null; workspaceRole: string | null; membershipStatus: string | null };
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]); const [users, setUsers] = useState<PlatformUser[]>([]); const [error, setError] = useState(""); const [tab, setTab] = useState<"workspaces" | "users">("workspaces"); const [query, setQuery] = useState(""); const [grantWorkspace, setGrantWorkspace] = useState<Workspace | null>(null);
  const load = useCallback(async () => { const [workspaceResponse, userResponse] = await Promise.all([fetch("/api/admin/workspaces"), fetch("/api/admin/users")]); const workspacePayload = await workspaceResponse.json() as { workspaces?: Workspace[]; error?: string }; const userPayload = await userResponse.json() as { users?: PlatformUser[]; error?: string }; if (workspaceResponse.ok && userResponse.ok) { setWorkspaces(workspacePayload.workspaces || []); setUsers(userPayload.users || []); setError(""); } else setError(workspacePayload.error || userPayload.error || "Could not load platform administration."); }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  async function update(organizationId: string, body: Record<string, unknown>) { const response = await fetch("/api/admin/workspaces", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ organizationId, ...body }) }); const payload = await response.json() as { error?: string }; if (!response.ok) return setError(payload.error || "Could not update workspace."); setError(""); setGrantWorkspace(null); void load(); }
  async function updateUser(userId: string, body: Record<string, unknown>) { const response = await fetch("/api/admin/users", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId, ...body }) }); const payload = await response.json() as { error?: string }; if (!response.ok) return setError(payload.error || "Could not update user."); setError(""); void load(); }
  if (data.viewer.platformRole !== "super_admin") return <section className="panel focused-empty"><Icon name="shield" size={30} /><h2>Platform administrator access required</h2></section>;
  const normalized = query.trim().toLowerCase(); const visibleWorkspaces = workspaces.filter((item) => !normalized || `${item.name} ${item.ownerEmail || ""} ${item.planKey}`.toLowerCase().includes(normalized)); const visibleUsers = users.filter((item) => !normalized || `${item.displayName} ${item.email} ${item.organizationName || ""}`.toLowerCase().includes(normalized));
  return <><section className="panel section-panel table-panel"><div className="section-toolbar admin-toolbar"><div><span className="panel-kicker">Application-wide control · Signed in as Platform Super Admin</span><h2>{workspaces.length} workspaces · {users.length} users</h2></div><input className="admin-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search workspaces or users" /></div><div className="admin-tabs"><button className={tab === "workspaces" ? "active" : ""} onClick={() => setTab("workspaces")}>Workspaces & access</button><button className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}>Platform users</button></div>{error ? <p className="legal-note">{error}</p> : null}{tab === "workspaces" ? <div className="data-table-wrap"><table className="data-table admin-table"><thead><tr><th>Workspace / owner</th><th>Plan</th><th>Access grant</th><th>Usage</th><th>Subscription</th><th>Controls</th></tr></thead><tbody>{visibleWorkspaces.map((workspace) => <tr key={workspace.id}><td><strong>{workspace.name}</strong><span>{workspace.ownerEmail || "No owner"} · Created {formatDate(workspace.createdAt, { month: "short", day: "numeric", year: "numeric" })}</span></td><td><select value={workspace.planKey} onChange={(event) => void update(workspace.id, { planKey: event.target.value })}><option value="trial">Trial</option><option value="starter">Starter</option><option value="growth">Growth</option><option value="pro">Pro</option></select></td><td><button className="grant-button" onClick={() => setGrantWorkspace(workspace)}><StatusBadge value={workspace.billingOverrideType === "none" ? "standard" : workspace.billingOverrideType} /><span>{workspace.billingOverrideType === "discount" ? `${workspace.billingDiscountPercent}% off` : workspace.billingOverrideType === "complimentary" ? "Free access" : "Standard billing"}{workspace.billingOverrideEndsAt ? ` · until ${formatDate(workspace.billingOverrideEndsAt, { month: "short", day: "numeric", year: "numeric" })}` : ""}</span></button></td><td><strong>{workspace.usage.callsStarted.toLocaleString()} calls</strong><span>{workspace.memberCount} members · {workspace.usage.contactsImported.toLocaleString()} imported</span></td><td><select value={workspace.subscriptionStatus} onChange={(event) => void update(workspace.id, { subscriptionStatus: event.target.value })}><option value="trialing">Trialing</option><option value="active">Active</option><option value="past_due">Past due</option><option value="canceled">Canceled</option><option value="incomplete">Incomplete</option></select></td><td><div className="table-actions"><button className={`text-button ${workspace.status === "active" ? "danger" : ""}`} onClick={() => { if (workspace.status !== "active" || window.confirm("Suspend this workspace? Non-platform users will lose access.")) void update(workspace.id, { status: workspace.status === "active" ? "suspended" : "active" }); }}>{workspace.status === "active" ? "Suspend" : "Reactivate"}</button><button className="text-button" onClick={() => { if (window.confirm("Reset this workspace’s current monthly usage counters? The audit log will retain the action.")) void update(workspace.id, { resetMonthlyUsage: true }); }}>Reset usage</button></div></td></tr>)}</tbody></table></div> : <div className="data-table-wrap"><table className="data-table admin-table"><thead><tr><th>User</th><th>Workspace</th><th>Workspace role</th><th>Platform role</th><th>Status</th><th>Last active</th></tr></thead><tbody>{visibleUsers.map((user) => <tr key={`${user.id}:${user.organizationName || "none"}`}><td><strong>{user.displayName}</strong><span>{user.email}</span></td><td>{user.organizationName || "No workspace"}</td><td>{humanize(user.workspaceRole || "none")}</td><td><select value={user.platformRole} disabled={user.id === data.viewer.userId} onChange={(event) => void updateUser(user.id, { platformRole: event.target.value })}><option value="user">User</option><option value="super_admin">Super admin</option></select></td><td><button className={`text-button ${user.status === "active" ? "danger" : ""}`} disabled={user.id === data.viewer.userId} onClick={() => { if (user.status !== "active" || window.confirm(`Suspend ${user.email} across the platform?`)) void updateUser(user.id, { status: user.status === "active" ? "suspended" : "active" }); }}>{user.id === data.viewer.userId ? "Protected" : user.status === "active" ? "Suspend user" : "Reactivate"}</button></td><td>{formatDate(user.lastSeenAt, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</td></tr>)}</tbody></table></div>}</section>{grantWorkspace ? <AccessGrantModal workspace={grantWorkspace} onClose={() => setGrantWorkspace(null)} onSave={(body) => void update(grantWorkspace.id, body)} /> : null}</>;
}

function AccessGrantModal({ workspace, onClose, onSave }: { workspace: { name: string; planKey: string; billingOverrideType: "none" | "complimentary" | "discount"; billingDiscountPercent: number; billingOverrideStartsAt: number | null; billingOverrideEndsAt: number | null; billingOverrideNote: string | null }; onClose: () => void; onSave: (body: Record<string, unknown>) => void }) {
  const [type, setType] = useState(workspace.billingOverrideType);
  return <div className="modal-backdrop"><section className="modal access-grant-modal" role="dialog" aria-modal="true"><div className="modal-header"><div><span className="panel-kicker">Platform billing override</span><h2>{workspace.name}</h2></div><button className="icon-button" onClick={onClose}><Icon name="close" /></button></div><form onSubmit={(event) => { event.preventDefault(); const values = new FormData(event.currentTarget); const start = String(values.get("startsAt") || ""); const end = String(values.get("endsAt") || ""); onSave({ billingOverrideType: type, billingDiscountPercent: Number(values.get("discountPercent")), billingOverrideStartsAt: start ? new Date(start).getTime() : Date.now(), billingOverrideEndsAt: end ? new Date(end).getTime() : null, billingOverrideNote: values.get("note") }); }}><div className="grant-type-grid"><label className={type === "none" ? "active" : ""}><input type="radio" name="grantType" value="none" checked={type === "none"} onChange={() => setType("none")} /><strong>Standard billing</strong><span>Remove platform override</span></label><label className={type === "complimentary" ? "active" : ""}><input type="radio" name="grantType" value="complimentary" checked={type === "complimentary"} onChange={() => setType("complimentary")} /><strong>Complimentary</strong><span>100% free access</span></label><label className={type === "discount" ? "active" : ""}><input type="radio" name="grantType" value="discount" checked={type === "discount"} onChange={() => setType("discount")} /><strong>Discounted</strong><span>Custom percentage</span></label></div>{type !== "none" ? <><div className="form-grid grant-date-grid">{type === "discount" ? <label className="form-field"><span>Discount percentage</span><input name="discountPercent" type="number" min={1} max={99} required defaultValue={workspace.billingDiscountPercent || 20} /></label> : null}<label className="form-field"><span>Starts</span><input name="startsAt" type="datetime-local" defaultValue={toDateTimeInput(workspace.billingOverrideStartsAt || Date.now())} /></label><label className="form-field"><span>Ends (optional)</span><input name="endsAt" type="datetime-local" defaultValue={workspace.billingOverrideEndsAt ? toDateTimeInput(workspace.billingOverrideEndsAt) : ""} /></label></div><label className="form-field"><span>Internal reason or agreement</span><textarea name="note" rows={3} maxLength={500} defaultValue={workspace.billingOverrideNote || ""} placeholder="Partner account, pilot program, negotiated customer discount…" /></label><div className="modal-note"><Icon name="shield" /><span>The selected {humanize(workspace.planKey)} plan caps remain enforced. Discounts apply in Stripe Checkout for full billing months through the selected end date.</span></div></> : <div className="modal-note"><Icon name="shield" /><span>This removes only the platform access grant. It does not cancel an existing Stripe subscription.</span></div>}<div className="modal-actions"><button className="button button-secondary" type="button" onClick={onClose}>Cancel</button><button className="button button-primary">Save access grant</button></div></form></section></div>;
}

function CampaignModal({ busy, data, onClose, onSubmit }: { busy: boolean; data: DashboardData | null; onClose: () => void; onSubmit: (form: HTMLFormElement) => void }) {
  const [voiceStack, setVoiceStack] = useState("twilio_openai");
  const selected = data?.integrations.voiceStacks.find((stack) => stack.key === voiceStack);
  const limits = selected?.limits;
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal campaign-modal" role="dialog" aria-modal="true" aria-labelledby="campaign-modal-title"><div className="modal-header"><div><span className="panel-kicker">Protected queue</span><h2 id="campaign-modal-title">New campaign</h2><p>Define what the agent represents, the provider stack, and the appointment it should earn.</p></div><button className="icon-button" type="button" aria-label="Close" onClick={onClose}><Icon name="close" size={18} /></button></div><form onSubmit={(event) => { event.preventDefault(); onSubmit(event.currentTarget); }}><section className="campaign-form-section"><span className="campaign-step">1 · Campaign identity</span><label className="form-field"><span>Campaign name</span><input name="name" required maxLength={100} placeholder="Industrial software discovery outreach" /></label><div className="form-grid campaign-fields-3"><label className="form-field"><span>Seller or business</span><input name="sellerName" required maxLength={100} placeholder="Your company" /></label><label className="form-field"><span>Product or offer</span><input name="productName" required maxLength={120} placeholder="Your product or service" /></label><label className="form-field"><span>AI agent name</span><input name="agentName" required maxLength={40} defaultValue="Alex" /></label></div></section><section className="campaign-form-section"><span className="campaign-step">2 · Agent instructions</span><label className="form-field"><span>Factual product brief</span><textarea name="productSummary" required minLength={40} maxLength={2000} rows={5} placeholder="Describe only verified product capabilities the agent may discuss. This brief is the agent’s source of truth." /><small>Review this carefully. The agent is instructed not to make claims beyond it.</small></label><div className="form-grid campaign-fields-2"><label className="form-field"><span>Campaign objective</span><select name="objective" defaultValue={CAMPAIGN_OBJECTIVES[0].value}>{CAMPAIGN_OBJECTIVES.map((objective) => <option value={objective.value} key={objective.value}>{objective.label}</option>)}</select><small>Supported qualification and booking workflow.</small></label><label className="form-field"><span>Scheduled appointment duration</span><select name="meetingDurationMinutes" defaultValue="30"><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">60 minutes</option></select><small>Calendar event length—not the AI call.</small></label></div><label className="form-field"><span>Voice provider stack</span><select name="voiceStack" value={voiceStack} onChange={(event) => setVoiceStack(event.target.value)}>{VOICE_STACKS.map((stack) => <option value={stack.key} key={stack.key}>{stack.label} · {stack.maturity}</option>)}</select><small>{selected?.description || "Choose how calls and live voice intelligence are delivered."}</small></label></section><section className="campaign-form-section campaign-limits-section"><span className="campaign-step">3 · Protected call capacity</span><div className="limit-summary-grid"><div><span>Effective concurrency</span><strong>{limits?.effectiveConcurrent ?? 1} calls</strong><small>Lower of provider, AI, global, and plan allowance</small></div><div><span>Outbound submission rate</span><strong>{limits?.effectiveCps ?? 1} CPS</strong><small>Approved {selected?.telephonyProvider ? humanize(selected.telephonyProvider) : "provider"} rate</small></div><div><span>Maximum live AI call</span><strong>15 minutes</strong><small>Separate from the calendar event length</small></div></div>{selected && !selected.configured ? <p className="legal-note">Connect both {humanize(selected.telephonyProvider)} and {humanize(selected.aiProvider)} before this campaign can launch.</p> : null}</section><div className="modal-note"><Icon name="prospects" size={17} /><span>All currently eligible prospects enter the draft queue and are rechecked again at launch.</span></div><div className="modal-actions"><button className="button button-secondary" type="button" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? "Creating…" : "Create protected campaign"}</button></div></form></section></div>;
}

function NavButton({ item, active, onClick, count }: { item: NavItem; active: boolean; onClick: () => void; count?: number }) {
  return <button type="button" className={`nav-item ${active ? "nav-item-active" : ""}`} onClick={onClick} aria-current={active ? "page" : undefined}><Icon name={item.icon} size={19} /><span>{item.label}</span>{count ? <span className="nav-count">{count}</span> : null}</button>;
}

function IntegrationRow({ icon, name, description, ready }: { icon: IconName; name: string; description: string; ready: boolean }) {
  return <div className="integration-row"><div className="integration-icon"><Icon name={icon} size={18} /></div><div className="integration-copy"><strong>{name}</strong><span>{description}</span></div><span className={`mini-state ${ready ? "mini-state-ready" : ""}`}>{ready ? "Ready" : "Pending"}</span></div>;
}

function IntegrationCard({ icon, name, description, ready, detail, action }: { icon: IconName; name: string; description: string; ready: boolean; detail: string; action?: ReactNode }) {
  return <article className="panel integration-card"><div className="integration-card-icon"><Icon name={icon} size={23} /></div><div><h2>{name}</h2><p>{description}</p></div><div className={`connection-state ${ready ? "connected" : ""}`}><span />{ready ? "Ready" : "Not connected"}</div><p className="integration-detail">{detail}</p>{action || <div className="config-locked"><Icon name="settings" size={15} />Server environment configuration</div>}</article>;
}

function DetailRow({ label, value }: { label: string; value: string }) { return <div className="campaign-detail-row"><span>{label}</span><strong>{value}</strong></div>; }

function ToolRow({ icon, title, copy }: { icon: IconName; title: string; copy: string }) { return <div className="tool-row"><span><Icon name={icon} size={17} /></span><div><strong>{title}</strong><small>{copy}</small></div></div>; }

function AuditList({ events }: { events: DashboardData["auditEvents"] }) {
  return <div className="audit-list">{events.map((event) => <div className="audit-row" key={event.id}><span className="audit-dot" /><div><strong>{humanize(event.eventType)}</strong><span>{event.actor} · {formatDate(event.createdAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span></div></div>)}</div>;
}

function StatusBadge({ value, title }: { value: string; title?: string }) { const tone = ["eligible", "confirmed", "completed", "connected"].includes(value) ? "eligible" : ["blocked", "failed", "canceled", "revoked"].includes(value) ? "blocked" : ["running", "calling", "ringing", "in-progress", "initiated"].includes(value) ? "running" : "draft"; return <span className={`status-badge status-${tone}`} title={title}>{humanize(value)}</span>; }

function EmptyState({ icon, title, copy, action, onAction }: { icon: IconName; title: string; copy: string; action: string; onAction: () => void }) { return <div className="empty-state"><div className="empty-icon"><Icon name={icon} size={25} /></div><div><strong>{title}</strong><span>{copy}</span></div><button className="button button-secondary" type="button" onClick={onAction}>{action}</button></div>; }

async function workbookRows(file: File): Promise<unknown[][]> {
  if (file.size > 8 * 1024 * 1024) throw new Error("The workbook must be smaller than 8 MB.");
  if (file.name.toLowerCase().endsWith(".csv") || file.type.includes("csv")) return parseCsv(await file.text());
  if (!file.name.toLowerCase().endsWith(".xlsx")) throw new Error("Choose an .xlsx or .csv file.");
  const { default: readXlsxFile } = await import("read-excel-file/browser");
  return (await readXlsxFile(file)) as unknown as unknown[][];
}

function parseCsv(value: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '"' && quoted && value[index + 1] === '"') { cell += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && value[index + 1] === "\n") index += 1;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += character;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function readinessLabel(key: string): string { return ({ voiceStack: "Complete voice stack", calendar: "Connected calendar", eligibleProspects: "Eligible prospects", baseUrl: "Webhook base URL", complianceGate: "Compliance gate" } as Record<string, string>)[key] || humanize(key); }
function humanize(value: string): string { return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function dayPart(): string { const hour = new Date().getHours(); return hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening"; }
function firstName(value: string): string { return value.split(/[\s@]/)[0] || "there"; }
function roleRank(value: string): number { return ({ viewer: 1, member: 2, manager: 3, admin: 4, owner: 5 } as Record<string, number>)[value] || 0; }
function formatDuration(seconds: number | null): string { if (!seconds && seconds !== 0) return "—"; const minutes = Math.floor(seconds / 60); const rest = seconds % 60; return `${minutes}:${String(rest).padStart(2, "0")}`; }
function formatDate(value: number, options: Intl.DateTimeFormatOptions): string { return new Intl.DateTimeFormat("en-US", options).format(new Date(value)); }
function toDateTimeInput(value: number): string { const date = new Date(value); const offset = date.getTimezoneOffset() * 60_000; return new Date(date.getTime() - offset).toISOString().slice(0, 16); }

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    prospects: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    campaigns: <><path d="m3 11 18-5v12L3 13z" /><path d="M11.6 14.8 13 21H8l-1.2-7.2" /></>,
    calls: <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.8a2 2 0 0 1-.45 2.11L8.1 9.9a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.84.57 2.8.7A2 2 0 0 1 22 16.92z" />,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></>,
    agent: <><rect x="4" y="7" width="16" height="13" rx="3" /><path d="M9 11h.01M15 11h.01M9 16h6M12 3v4" /></>,
    shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" /></>,
    plug: <><path d="M12 22v-5M9 8V2M15 8V2M18 8v4a6 6 0 0 1-12 0V8z" /></>,
    upload: <><path d="M12 3v12M7 8l5-5 5 5" /><path d="M5 21h14" /></>,
    download: <><path d="M12 3v12M7 10l5 5 5-5" /><path d="M5 21h14" /></>,
    phone: <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.8a2 2 0 0 1-.45 2.11L8.1 9.9a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.84.57 2.8.7A2 2 0 0 1 22 16.92z" />,
    arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    refresh: <><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    block: <><circle cx="12" cy="12" r="9" /><path d="m6 6 12 12" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.5-2.4 1A8 8 0 0 0 15 6l-.3-2.6h-4L10.4 6A8 8 0 0 0 9 7L6.5 6 4.4 9.5 6.5 11a7 7 0 0 0 0 2l-2.1 1.5L6.5 18 9 17a8 8 0 0 0 1.4 1l.3 2.6h4L15 18a8 8 0 0 0 1.5-1l2.4 1 2-3.5-2-1.5a7 7 0 0 0 .1-1z" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
