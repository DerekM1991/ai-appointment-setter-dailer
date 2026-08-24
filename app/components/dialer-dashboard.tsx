"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

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

type DashboardData = {
  viewer: { displayName: string; email: string };
  metrics: { eligible: number; blocked: number; active: number; booked: number };
  readiness: Record<"twilio" | "openai" | "outlook" | "eligibleProspects" | "baseUrl", boolean>;
  readinessPassed: number;
  leads: Array<{
    id: string;
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
    blockReasons: string[];
    createdAt: number;
  }>;
  campaigns: Array<{
    id: string;
    name: string;
    productSummary: string;
    objective: string;
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
  auditEvents: Array<{
    id: string;
    actor: string;
    eventType: string;
    entityType: string | null;
    details: Record<string, unknown>;
    createdAt: number;
  }>;
  integrations: {
    outlook: { connected: boolean; accountEmail: string | null };
    twilio: { configured: boolean };
    openai: { configured: boolean; model: string };
    appBaseUrl: { configured: boolean };
  };
};

type Toast = { tone: "success" | "error" | "info"; message: string };

const primaryNav: NavItem[] = [
  { id: "overview", label: "Overview", icon: "overview" },
  { id: "prospects", label: "Prospects", icon: "prospects" },
  { id: "campaigns", label: "Campaigns", icon: "campaigns" },
  { id: "calls", label: "Calls", icon: "calls" },
  { id: "appointments", label: "Appointments", icon: "calendar" },
];

const systemNav: NavItem[] = [
  { id: "agent", label: "Agent studio", icon: "agent" },
  { id: "compliance", label: "Compliance", icon: "shield" },
  { id: "integrations", label: "Integrations", icon: "plug" },
];

const sectionTitles: Record<string, { eyebrow: string; title: string; subtitle: string }> = {
  overview: {
    eyebrow: "Campaign control",
    title: "Calling operations",
    subtitle: "A protected workspace for consented outreach and Outlook scheduling.",
  },
  prospects: {
    eyebrow: "Lead operations",
    title: "Prospects",
    subtitle: "Import, validate, and qualify every contact before dialing.",
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
    subtitle: "Connect Outlook and verify the production calling services.",
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
  const [complianceAttested, setComplianceAttested] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const navigation = useMemo(() => [...primaryNav, ...systemNav], []);
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
      if (params.get("outlook") === "connected") {
        setToast({ tone: "success", message: "Outlook connected successfully." });
        window.history.replaceState({}, "", "/");
      } else if (params.get("outlook_error")) {
        setToast({ tone: "error", message: params.get("outlook_error") || "Outlook connection failed." });
        window.history.replaceState({}, "", "/");
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
          productSummary: values.get("productSummary"),
          objective: values.get("objective"),
          maxConcurrent: Number(values.get("maxConcurrent")),
          callsPerSecond: Number(values.get("callsPerSecond")),
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
          ? `${result.launched} calls entered Twilio. ${result.blocked} were blocked; ${result.skippedOutsideWindow} are waiting for local hours.`
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
            <div className="brand-name">ODIN</div>
            <div className="brand-subtitle">AI APPOINTMENT DIALER</div>
          </div>
        </div>
        <nav className="navigation" aria-label="Primary navigation">
          <div className="nav-label">Workspace</div>
          {primaryNav.map((item) => (
            <NavButton key={item.id} item={item} active={activeSection === item.id} onClick={() => selectSection(item.id)} />
          ))}
          <div className="nav-label nav-label-spaced">System</div>
          {systemNav.map((item) => (
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
          <div className="profile-button">
            <span className="profile-avatar">{initials}</span>
            <span className="profile-copy">
              <strong>{displayName}</strong>
              <span title={userEmail}>Administrator</span>
            </span>
            <Icon name="settings" size={17} />
          </div>
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
            />
          )}
        </div>
      </main>

      {campaignModal ? (
        <CampaignModal
          busy={busy === "campaign-create"}
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
}) {
  const data = props.data;
  if (!data) return null;
  if (props.section === "overview") return <Overview data={data} onNavigate={props.onNavigate} onImport={props.onImport} />;
  if (props.section === "prospects") return <Prospects data={data} onImport={props.onImport} busy={props.busy === "import"} />;
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
  return <IntegrationsView data={data} onDisconnectOutlook={props.onDisconnectOutlook} busy={props.busy} />;
}

function Overview({ data, onNavigate, onImport }: { data: DashboardData; onNavigate: (id: string) => void; onImport: () => void }) {
  const metrics = [
    { label: "Eligible prospects", value: data.metrics.eligible, detail: "Written consent verified", icon: "prospects" as IconName, tone: "cyan" },
    { label: "Live sessions", value: `${data.metrics.active} / 20`, detail: "Concurrency limit", icon: "phone" as IconName, tone: "blue" },
    { label: "Meetings booked", value: data.metrics.booked, detail: "Confirmed in Outlook", icon: "calendar" as IconName, tone: "green" },
    { label: "Compliance blocked", value: data.metrics.blocked, detail: "Never sent to dialer", icon: "block" as IconName, tone: "amber" },
  ];
  const campaign = data.campaigns[0];
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
          <div className="guardrail-strip"><Icon name="shield" size={18} /><div><strong>Launch is protected</strong><span>Every lead is revalidated immediately before Twilio receives the number.</span></div></div>
          <div className="panel-actions"><button className="button button-secondary" type="button" onClick={() => onNavigate("campaigns")}>Review campaign</button><button className="button button-primary" type="button" onClick={() => onNavigate("campaigns")}><Icon name="phone" size={17} />Launch controls</button></div>
        </article>
        <article className="panel setup-panel">
          <div className="panel-header compact"><div><span className="panel-kicker">Production setup</span><h2>Required connections</h2></div><button className="text-button" type="button" onClick={() => onNavigate("integrations")}>View all <Icon name="arrow" size={15} /></button></div>
          <div className="integration-list">
            <IntegrationRow icon="calendar" name="Microsoft Outlook" description={data.integrations.outlook.accountEmail || "Calendar availability and Teams invitations"} ready={data.integrations.outlook.connected} />
            <IntegrationRow icon="phone" name="Twilio Voice" description="Verified outbound calling and call events" ready={data.integrations.twilio.configured} />
            <IntegrationRow icon="agent" name="OpenAI" description={data.integrations.openai.model} ready={data.integrations.openai.configured} />
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

function Prospects({ data, onImport, busy }: { data: DashboardData; onImport: () => void; busy: boolean }) {
  return (
    <section className="panel section-panel table-panel">
      <div className="section-toolbar"><div><span className="panel-kicker">Consent-controlled list</span><h2>{data.leads.length} recent prospects</h2></div><div className="toolbar-actions"><a className="button button-secondary" href="/api/leads/template"><Icon name="download" size={17} />Template</a><button className="button button-primary" type="button" onClick={onImport} disabled={busy}><Icon name="upload" size={17} />{busy ? "Importing…" : "Import Excel or CSV"}</button></div></div>
      {!data.leads.length ? (
        <div className="import-zone" onClick={onImport} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") onImport(); }}>
          <div className="import-graphic"><Icon name="upload" size={27} /></div><h2>Bring in your prospect workbook</h2><p>Excel and CSV files are normalized, deduplicated, and held outside the dialer until consent and DNC evidence pass validation.</p><div className="template-fields"><span>Phone</span><span>Express-written consent</span><span>Consent timestamp + evidence</span><span>DNC checked date</span><span>IANA timezone</span></div>
        </div>
      ) : (
        <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Prospect</th><th>Phone</th><th>Timezone</th><th>Consent</th><th>DNC check</th><th>Status</th></tr></thead><tbody>{data.leads.map((lead) => <tr key={lead.id}><td><strong>{lead.firstName} {lead.lastName}</strong><span>{[lead.title, lead.company].filter(Boolean).join(" · ") || "—"}</span></td><td>{lead.phoneE164}</td><td>{lead.timezone || "Missing"}</td><td>{humanize(lead.consentStatus)}</td><td>{lead.dncCheckedAt ? formatDate(lead.dncCheckedAt, { month: "short", day: "numeric", year: "numeric" }) : "Missing"}</td><td><StatusBadge value={lead.status} title={lead.blockReasons.map(humanize).join(", ")} /></td></tr>)}</tbody></table></div>
      )}
      <div className="policy-footnote"><Icon name="shield" size={17} /><span>An imported row is never treated as consent. The required evidence must already exist in the workbook.</span></div>
    </section>
  );
}

function CampaignsView({ data, busy, attested, setAttested, onCreate, onLaunch }: { data: DashboardData; busy: string | null; attested: boolean; setAttested: (value: boolean) => void; onCreate: () => void; onLaunch: (id: string) => void }) {
  const allReady = Object.values(data.readiness).every(Boolean);
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
          return <article className="panel campaign-list-card" key={campaign.id}><div className="panel-header compact"><div><span className="panel-kicker">{campaign.objective}</span><h2>{campaign.name}</h2></div><StatusBadge value={campaign.status} /></div><p>{campaign.productSummary}</p><div className="campaign-stat-row"><div><span>Queued</span><strong>{queued}</strong></div><div><span>Concurrency</span><strong>{campaign.maxConcurrent}</strong></div><div><span>Twilio CPS</span><strong>{campaign.callsPerSecond}</strong></div><div><span>Meeting</span><strong>{campaign.meetingDurationMinutes} min</strong></div></div><div className="panel-actions"><span className="launch-note">Calling begins only during each prospect’s local window.</span><button className="button button-primary" type="button" disabled={!allReady || !attested || queued === 0 || launching} onClick={() => onLaunch(campaign.id)}><Icon name="phone" size={17} />{launching ? "Launching…" : "Start protected calling"}</button></div></article>;
        }) : <section className="panel focused-empty"><div className="focused-icon"><Icon name="campaigns" size={30} /></div><h2>Create your first protected campaign</h2><p>Every currently eligible prospect will be added to its controlled queue. Review the product brief before launch.</p><button className="button button-primary" type="button" onClick={onCreate}>New campaign <Icon name="arrow" size={15} /></button></section>}
      </section>
    </>
  );
}

function CallsView({ data }: { data: DashboardData }) {
  if (!data.calls.length) return <section className="panel focused-empty"><div className="focused-icon"><Icon name="calls" size={30} /></div><h2>Every call leaves an audit trail</h2><p>Provider status, transcript-derived outcomes, summaries, opt-outs, and appointment links will appear here.</p></section>;
  return <section className="panel section-panel table-panel"><div className="section-toolbar"><div><span className="panel-kicker">Provider and agent ledger</span><h2>{data.calls.length} recent calls</h2></div><span className="live-refresh"><i />Updates every 10 seconds</span></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Prospect</th><th>Status</th><th>Outcome</th><th>Started</th><th>Duration</th><th>Summary</th></tr></thead><tbody>{data.calls.map((call) => <tr key={call.id}><td><strong>{call.firstName} {call.lastName}</strong><span>{call.company || call.twilioCallSid || "—"}</span></td><td><StatusBadge value={call.status} /></td><td>{humanize(call.outcome || "pending")}</td><td>{call.startedAt ? formatDate(call.startedAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"}</td><td>{formatDuration(call.durationSeconds)}</td><td className="summary-cell">{call.summary || "—"}</td></tr>)}</tbody></table></div></section>;
}

function AppointmentsView({ data, onConnect }: { data: DashboardData; onConnect: () => void }) {
  if (!data.integrations.outlook.connected) return <section className="panel focused-empty"><div className="focused-icon"><Icon name="calendar" size={30} /></div><h2>Outlook is not connected yet</h2><p>Connect Microsoft Graph so the agent can read real availability and create Outlook or Teams invitations.</p><button className="button button-primary" type="button" onClick={onConnect}>Connect Outlook <Icon name="arrow" size={15} /></button></section>;
  if (!data.appointments.length) return <section className="panel focused-empty"><div className="focused-icon"><Icon name="calendar" size={30} /></div><h2>Outlook is ready</h2><p>Confirmed meetings will appear here with their source prospect and Teams link.</p></section>;
  return <section className="panel section-panel table-panel"><div className="section-toolbar"><div><span className="panel-kicker">Microsoft Graph events</span><h2>{data.appointments.length} appointments</h2></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Prospect</th><th>When</th><th>Email</th><th>Status</th><th>Meeting</th></tr></thead><tbody>{data.appointments.map((appointment) => <tr key={appointment.id}><td><strong>{appointment.firstName} {appointment.lastName}</strong><span>{appointment.company || appointment.subject}</span></td><td><strong>{formatDate(appointment.startAt, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: appointment.timezone })}</strong><span>{appointment.timezone}</span></td><td>{appointment.attendeeEmail}</td><td><StatusBadge value={appointment.status} /></td><td>{appointment.joinUrl ? <a className="table-link" href={appointment.joinUrl} target="_blank" rel="noreferrer">Open Teams <Icon name="arrow" size={13} /></a> : "Outlook event"}</td></tr>)}</tbody></table></div></section>;
}

function AgentView({ data }: { data: DashboardData }) {
  return <section className="agent-grid"><article className="panel agent-identity"><div className="agent-orb"><span /><span /><span /></div><div><span className="panel-kicker">Active identity</span><h2>ODIN qualification agent</h2><p>Warm and conversational, but always truthful about being AI and calling for ODIN Asset Manager.</p></div><div className="connection-state connected"><span />{data.integrations.openai.model}</div></article><article className="panel"><div className="panel-header compact"><div><span className="panel-kicker">Mandatory opening</span><h2>Disclosure before dialogue</h2></div><Icon name="shield" size={22} /></div><blockquote>“I’m ODIN, an AI assistant calling on behalf of ODIN Asset Manager. This is a sales call…”</blockquote><p className="muted-copy">The greeting is generated in TwiML and timestamped before the model handles the first response.</p></article><article className="panel tool-policy"><span className="panel-kicker">Approved actions</span><h2>Small, auditable tool surface</h2><div className="tool-list"><ToolRow icon="calendar" title="Read Outlook availability" copy="Returns up to three free local-time slots." /><ToolRow icon="check" title="Create one appointment" copy="Requires exact slot, valid email, and explicit confirmation." /><ToolRow icon="block" title="Enforce opt-out" copy="Immediately suppresses the lead outside model discretion." /></div></article><article className="panel tool-policy"><span className="panel-kicker">Never permitted</span><h2>Hard boundaries</h2><div className="boundary-list"><span>Impersonate a human</span><span>Invent price or product claims</span><span>Call an unverified prospect</span><span>Book without confirmation</span><span>Continue after an opt-out</span></div></article></section>;
}

function ComplianceView({ data }: { data: DashboardData }) {
  const rules = [
    ["Prior express written consent", "Status, timestamp, source, and evidence are all required."],
    ["DNC freshness", "A dated screening record must be no more than 31 days old."],
    ["Local calling hours", "Weekdays from 9:00 AM to 4:30 PM in the prospect’s IANA timezone."],
    ["Internal suppression", "A spoken opt-out immediately revokes consent and blocks future calls."],
    ["AI disclosure", "The Twilio greeting identifies the assistant as AI before conversation begins."],
  ];
  return <section className="compliance-layout"><article className="panel"><div className="panel-header compact"><div><span className="panel-kicker">Server-enforced rules</span><h2>Calling policy</h2></div><span className="status-badge status-eligible">Active</span></div><div className="rule-list">{rules.map(([title, copy]) => <div className="rule-row" key={title}><span className="control-check"><Icon name="check" size={13} /></span><div><strong>{title}</strong><span>{copy}</span></div></div>)}</div><div className="legal-note"><Icon name="shield" size={18} /><p>This software provides technical safeguards, not legal advice. The operator remains responsible for jurisdiction-specific telemarketing, recording, caller-ID, licensing, and industry rules.</p></div></article><article className="panel audit-panel"><div className="panel-header compact"><div><span className="panel-kicker">Append-only events</span><h2>Audit log</h2></div><span className="live-refresh"><i />Live</span></div>{data.auditEvents.length ? <AuditList events={data.auditEvents} /> : <div className="compact-empty">No audit events yet.</div>}</article></section>;
}

function IntegrationsView({ data, onDisconnectOutlook, busy }: { data: DashboardData; onDisconnectOutlook: () => void; busy: string | null }) {
  return <section className="integration-card-grid"><IntegrationCard icon="calendar" name="Microsoft Outlook" description="Availability, Outlook events, and Teams invitations" ready={data.integrations.outlook.connected} detail={data.integrations.outlook.accountEmail || "OAuth 2.0 not connected"} action={data.integrations.outlook.connected ? <button className="button button-secondary" type="button" onClick={onDisconnectOutlook} disabled={busy === "outlook-disconnect"}>{busy === "outlook-disconnect" ? "Disconnecting…" : "Disconnect"}</button> : <a className="button button-primary" href="/api/outlook/connect">Connect Outlook <Icon name="arrow" size={15} /></a>} /><IntegrationCard icon="phone" name="Twilio Voice" description="Outbound Calls API, signed webhooks, and ConversationRelay" ready={data.integrations.twilio.configured} detail={data.integrations.twilio.configured ? "Credentials loaded securely" : "Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER"} /><IntegrationCard icon="agent" name="OpenAI" description="Structured, low-latency conversation decisions" ready={data.integrations.openai.configured} detail={data.integrations.openai.configured ? data.integrations.openai.model : "Set OPENAI_API_KEY; OPENAI_MODEL is optional"} /><IntegrationCard icon="shield" name="Application security" description="Canonical webhook URLs and encrypted OAuth tokens" ready={data.integrations.appBaseUrl.configured} detail={data.integrations.appBaseUrl.configured ? "APP_BASE_URL and encrypted token storage ready" : "Set APP_BASE_URL and a base64 32-byte APP_ENCRYPTION_KEY"} /></section>;
}

function CampaignModal({ busy, onClose, onSubmit }: { busy: boolean; onClose: () => void; onSubmit: (form: HTMLFormElement) => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="campaign-modal-title"><div className="modal-header"><div><span className="panel-kicker">Protected queue</span><h2 id="campaign-modal-title">New campaign</h2></div><button className="icon-button" type="button" aria-label="Close" onClick={onClose}><Icon name="close" size={18} /></button></div><form onSubmit={(event) => { event.preventDefault(); onSubmit(event.currentTarget); }}><label className="form-field"><span>Campaign name</span><input name="name" required maxLength={100} placeholder="ODIN mechanical-integrity outreach" /></label><label className="form-field"><span>Factual product brief</span><textarea name="productSummary" required minLength={40} maxLength={2000} rows={5} placeholder="Describe only verified product capabilities the agent may discuss. This brief is the agent’s source of truth." /><small>Review this carefully. The agent is instructed not to make claims beyond it.</small></label><label className="form-field"><span>Objective</span><input name="objective" defaultValue="Book a discovery call" maxLength={160} /></label><div className="form-grid"><label className="form-field"><span>Concurrent calls</span><input name="maxConcurrent" type="number" min={1} max={20} defaultValue={20} /></label><label className="form-field"><span>Twilio CPS</span><input name="callsPerSecond" type="number" min={1} max={5} defaultValue={1} /></label><label className="form-field"><span>Meeting length</span><select name="meetingDurationMinutes" defaultValue="30"><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">60 minutes</option></select></label></div><div className="modal-note"><Icon name="prospects" size={17} /><span>All currently eligible prospects will enter the draft queue. They are rechecked at launch.</span></div><div className="modal-actions"><button className="button button-secondary" type="button" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? "Creating…" : "Create protected campaign"}</button></div></form></section></div>;
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

function readinessLabel(key: string): string { return ({ twilio: "Twilio Voice", openai: "OpenAI agent", outlook: "Outlook calendar", eligibleProspects: "Eligible prospects", baseUrl: "Webhook base URL" } as Record<string, string>)[key] || humanize(key); }
function humanize(value: string): string { return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function dayPart(): string { const hour = new Date().getHours(); return hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening"; }
function firstName(value: string): string { return value.split(/[\s@]/)[0] || "there"; }
function formatDuration(seconds: number | null): string { if (!seconds && seconds !== 0) return "—"; const minutes = Math.floor(seconds / 60); const rest = seconds % 60; return `${minutes}:${String(rest).padStart(2, "0")}`; }
function formatDate(value: number, options: Intl.DateTimeFormatOptions): string { return new Intl.DateTimeFormat("en-US", options).format(new Date(value)); }

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
