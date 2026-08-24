"use client";

import { useMemo, useState } from "react";

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
  | "settings";

type NavItem = {
  id: string;
  label: string;
  icon: IconName;
};

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

const metrics = [
  {
    label: "Eligible prospects",
    value: "0",
    detail: "Written consent verified",
    icon: "prospects" as IconName,
    tone: "cyan",
  },
  {
    label: "Live sessions",
    value: "0 / 20",
    detail: "Concurrency limit",
    icon: "phone" as IconName,
    tone: "blue",
  },
  {
    label: "Meetings booked",
    value: "0",
    detail: "This campaign",
    icon: "calendar" as IconName,
    tone: "green",
  },
  {
    label: "Compliance blocked",
    value: "0",
    detail: "Never sent to dialer",
    icon: "block" as IconName,
    tone: "amber",
  },
];

const integrationRows = [
  {
    name: "Microsoft Outlook",
    description: "Calendar availability and Teams invitations",
    status: "Connect",
    icon: "calendar" as IconName,
  },
  {
    name: "Twilio Voice",
    description: "Verified outbound calling and call events",
    status: "Configure",
    icon: "phone" as IconName,
  },
  {
    name: "OpenAI",
    description: "Natural conversation and approved tool use",
    status: "Configure",
    icon: "agent" as IconName,
  },
];

const sectionTitles: Record<
  string,
  { eyebrow: string; title: string; subtitle: string }
> = {
  overview: {
    eyebrow: "Campaign control",
    title: "Good evening, Derek",
    subtitle: "Your ODIN calling operation is quiet and protected.",
  },
  prospects: {
    eyebrow: "Lead operations",
    title: "Prospects",
    subtitle: "Import, validate, and qualify every contact before dialing.",
  },
  campaigns: {
    eyebrow: "Outbound programs",
    title: "Campaigns",
    subtitle:
      "Build controlled calling queues with transparent eligibility rules.",
  },
  calls: {
    eyebrow: "Conversation ledger",
    title: "Calls",
    subtitle: "Monitor outcomes, summaries, transcripts, and opt-out events.",
  },
  appointments: {
    eyebrow: "Outlook calendar",
    title: "Appointments",
    subtitle: "Review meetings created by the agent and their source calls.",
  },
  agent: {
    eyebrow: "Conversation design",
    title: "Agent studio",
    subtitle: "Control what the ODIN agent can say, ask, and do.",
  },
  compliance: {
    eyebrow: "Policy center",
    title: "Compliance",
    subtitle:
      "Keep consent, suppression, calling-window, and audit controls visible.",
  },
  integrations: {
    eyebrow: "System connections",
    title: "Integrations",
    subtitle: "Connect the services required for safe production calling.",
  },
};

export default function DialerDashboard() {
  const [activeSection, setActiveSection] = useState("overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const heading = sectionTitles[activeSection] ?? sectionTitles.overview;
  const navigation = useMemo(() => [...primaryNav, ...systemNav], []);
  const activeLabel =
    navigation.find((item) => item.id === activeSection)?.label ?? "Overview";

  function selectSection(id: string) {
    setActiveSection(id);
    setMenuOpen(false);
  }

  return (
    <div className="app-shell">
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
            <NavButton
              key={item.id}
              item={item}
              active={activeSection === item.id}
              onClick={() => selectSection(item.id)}
            />
          ))}
          <div className="nav-label nav-label-spaced">System</div>
          {systemNav.map((item) => (
            <NavButton
              key={item.id}
              item={item}
              active={activeSection === item.id}
              onClick={() => selectSection(item.id)}
            />
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="safety-status">
            <span className="safety-pulse" />
            <div>
              <strong>Safe mode active</strong>
              <span>Live calling is locked</span>
            </div>
          </div>
          <button className="profile-button" type="button">
            <span className="profile-avatar">DM</span>
            <span className="profile-copy">
              <strong>Derek Murphy</strong>
              <span>Administrator</span>
            </span>
            <Icon name="settings" size={17} />
          </button>
        </div>
      </aside>

      {menuOpen ? (
        <button
          className="sidebar-scrim"
          type="button"
          aria-label="Close navigation"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}

      <main className="main-content">
        <header className="topbar">
          <button
            className="mobile-menu"
            type="button"
            aria-label="Open navigation"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
          >
            <span />
            <span />
            <span />
          </button>
          <div className="mobile-title">{activeLabel}</div>
          <div className="topbar-actions">
            <div className="readiness-chip">
              <span /> Launch readiness: 1 of 5
            </div>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => selectSection("prospects")}
            >
              <Icon name="upload" size={17} />
              Import prospects
            </button>
          </div>
        </header>

        <div className="content-wrap">
          <section className="page-heading">
            <div>
              <div className="eyebrow">{heading.eyebrow}</div>
              <h1>{heading.title}</h1>
              <p>{heading.subtitle}</p>
            </div>
            <div className="page-date">
              <Icon name="clock" size={17} />
              Sunday, August 24
            </div>
          </section>

          {activeSection === "overview" ? (
            <Overview onNavigate={selectSection} />
          ) : (
            <SectionPanel section={activeSection} onNavigate={selectSection} />
          )}
        </div>
      </main>
    </div>
  );
}

function NavButton({
  item,
  active,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`nav-item ${active ? "nav-item-active" : ""}`}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
    >
      <Icon name={item.icon} size={19} />
      <span>{item.label}</span>
      {item.id === "compliance" ? <span className="nav-count">0</span> : null}
    </button>
  );
}

function Overview({ onNavigate }: { onNavigate: (id: string) => void }) {
  return (
    <>
      <section className="metric-grid" aria-label="Campaign metrics">
        {metrics.map((metric) => (
          <article className="metric-card" key={metric.label}>
            <div className={`metric-icon metric-icon-${metric.tone}`}>
              <Icon name={metric.icon} size={19} />
            </div>
            <div className="metric-label">{metric.label}</div>
            <div className="metric-value">{metric.value}</div>
            <div className="metric-detail">{metric.detail}</div>
          </article>
        ))}
      </section>

      <section className="overview-grid">
        <article className="panel campaign-panel">
          <div className="panel-header">
            <div>
              <span className="panel-kicker">Next campaign</span>
              <h2>ODIN industrial outreach</h2>
            </div>
            <span className="status-badge status-draft">Draft</span>
          </div>

          <div className="campaign-summary">
            <div
              className="campaign-ring"
              aria-label="Campaign readiness 20 percent"
            >
              <div>
                <strong>20%</strong>
                <span>ready</span>
              </div>
            </div>
            <div className="campaign-details">
              <div className="campaign-detail-row">
                <span>Eligible queue</span>
                <strong>0 prospects</strong>
              </div>
              <div className="campaign-detail-row">
                <span>Maximum live calls</span>
                <strong>20 concurrent</strong>
              </div>
              <div className="campaign-detail-row">
                <span>Calling window</span>
                <strong>9:00 AM–4:30 PM local</strong>
              </div>
            </div>
          </div>

          <div className="guardrail-strip">
            <Icon name="shield" size={18} />
            <div>
              <strong>Launch is protected</strong>
              <span>
                Five controls must pass before any number is sent to Twilio.
              </span>
            </div>
          </div>

          <div className="panel-actions">
            <button
              className="button button-secondary"
              type="button"
              onClick={() => onNavigate("campaigns")}
            >
              Review campaign
            </button>
            <button className="button button-primary" type="button" disabled>
              <Icon name="phone" size={17} />
              Start calling
            </button>
          </div>
        </article>

        <article className="panel setup-panel">
          <div className="panel-header compact">
            <div>
              <span className="panel-kicker">Production setup</span>
              <h2>Required connections</h2>
            </div>
            <button
              className="text-button"
              type="button"
              onClick={() => onNavigate("integrations")}
            >
              View all <Icon name="arrow" size={15} />
            </button>
          </div>
          <div className="integration-list">
            {integrationRows.map((item) => (
              <div className="integration-row" key={item.name}>
                <div className="integration-icon">
                  <Icon name={item.icon} size={18} />
                </div>
                <div className="integration-copy">
                  <strong>{item.name}</strong>
                  <span>{item.description}</span>
                </div>
                <button type="button" className="integration-action">
                  {item.status}
                </button>
              </div>
            ))}
          </div>
          <div className="verified-control">
            <span className="control-check">
              <Icon name="check" size={13} />
            </span>
            <div>
              <strong>Compliance gate installed</strong>
              <span>Unverified contacts cannot enter a calling queue.</span>
            </div>
          </div>
        </article>
      </section>

      <section className="panel activity-panel">
        <div className="panel-header compact">
          <div>
            <span className="panel-kicker">Operational feed</span>
            <h2>Recent activity</h2>
          </div>
          <div className="activity-legend">
            <span>
              <i className="legend-live" /> Live
            </span>
            <span>
              <i className="legend-safe" /> Protected
            </span>
          </div>
        </div>
        <div className="empty-state">
          <div className="empty-icon">
            <Icon name="calls" size={25} />
          </div>
          <div>
            <strong>No calls yet</strong>
            <span>
              Import consented prospects and complete your connections to
              begin.
            </span>
          </div>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => onNavigate("prospects")}
          >
            Import Excel sheet
          </button>
        </div>
      </section>
    </>
  );
}

function SectionPanel({
  section,
  onNavigate,
}: {
  section: string;
  onNavigate: (id: string) => void;
}) {
  if (section === "prospects") {
    return (
      <section className="panel section-panel">
        <div className="section-toolbar">
          <div className="search-box">
            <Icon name="prospects" size={17} />
            <span>Search prospects by name, company, or phone</span>
          </div>
          <button className="button button-primary" type="button">
            <Icon name="upload" size={17} /> Import Excel sheet
          </button>
        </div>
        <div className="import-zone">
          <div className="import-graphic">
            <Icon name="upload" size={27} />
          </div>
          <h2>Bring in your prospect workbook</h2>
          <p>
            Excel and CSV files are normalized, deduplicated, and held outside
            the dialer until consent and DNC evidence pass validation.
          </p>
          <div className="template-fields">
            <span>Required: Phone</span>
            <span>Consent status</span>
            <span>Consent timestamp</span>
            <span>DNC checked</span>
          </div>
        </div>
      </section>
    );
  }

  if (section === "integrations") {
    return (
      <section className="integration-card-grid">
        {integrationRows.map((item) => (
          <article className="panel integration-card" key={item.name}>
            <div className="integration-card-icon">
              <Icon name={item.icon} size={23} />
            </div>
            <div>
              <h2>{item.name}</h2>
              <p>{item.description}</p>
            </div>
            <div className="connection-state">
              <span /> Not connected
            </div>
            <button className="button button-secondary" type="button">
              {item.status} <Icon name="arrow" size={15} />
            </button>
          </article>
        ))}
      </section>
    );
  }

  const cards: Record<
    string,
    { title: string; copy: string; action: string; icon: IconName }
  > = {
    campaigns: {
      title: "Create your first protected campaign",
      copy: "Choose eligible prospects, local calling hours, concurrency, retry rules, and the approved agent script.",
      action: "New campaign",
      icon: "campaigns",
    },
    calls: {
      title: "Every call leaves an audit trail",
      copy: "Call status, participant responses, agent summaries, opt-outs, and appointment links appear here.",
      action: "Review compliance",
      icon: "calls",
    },
    appointments: {
      title: "Outlook is not connected yet",
      copy: "Connect your Microsoft account so the agent can offer real availability and create Teams invitations.",
      action: "Connect Outlook",
      icon: "calendar",
    },
    agent: {
      title: "ODIN qualification agent",
      copy: "The agent discloses that it is AI, identifies ODIN, handles approved objections, and can only use scheduling and opt-out tools.",
      action: "Edit agent brief",
      icon: "agent",
    },
    compliance: {
      title: "No unresolved compliance events",
      copy: "Written consent, DNC freshness, local calling windows, opt-outs, and provider signatures are enforced server-side.",
      action: "View policy rules",
      icon: "shield",
    },
  };

  const card = cards[section] ?? cards.campaigns;
  return (
    <section className="panel section-panel focused-empty">
      <div className="focused-icon">
        <Icon name={card.icon} size={30} />
      </div>
      <h2>{card.title}</h2>
      <p>{card.copy}</p>
      <button
        className="button button-primary"
        type="button"
        onClick={() =>
          section === "appointments" ? onNavigate("integrations") : undefined
        }
      >
        {card.action} <Icon name="arrow" size={15} />
      </button>
    </section>
  );
}

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    overview: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    prospects: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
    campaigns: (
      <>
        <path d="m3 11 18-5v12L3 13z" />
        <path d="M11.6 14.8 13 21H8l-1.2-7.2" />
      </>
    ),
    calls: (
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.8a2 2 0 0 1-.45 2.11L8.1 9.9a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.84.57 2.8.7A2 2 0 0 1 22 16.92z" />
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M16 3v4M8 3v4M3 11h18" />
      </>
    ),
    agent: (
      <>
        <rect x="4" y="7" width="16" height="13" rx="3" />
        <path d="M9 11h.01M15 11h.01M9 16h6M12 3v4" />
      </>
    ),
    shield: (
      <>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
    plug: (
      <>
        <path d="M12 22v-5M9 8V2M15 8V2M18 8v4a6 6 0 0 1-12 0V8z" />
      </>
    ),
    upload: (
      <>
        <path d="M12 3v12M7 8l5-5 5 5" />
        <path d="M5 21h14" />
      </>
    ),
    phone: (
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.8a2 2 0 0 1-.45 2.11L8.1 9.9a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.84.57 2.8.7A2 2 0 0 1 22 16.92z" />
    ),
    arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
    check: <path d="m5 12 4 4L19 6" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    block: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m6 6 12 12" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.5-2.4 1A8 8 0 0 0 15 6l-.3-2.6h-4L10.4 6A8 8 0 0 0 9 7L6.5 6 4.4 9.5 6.5 11a7 7 0 0 0 0 2l-2.1 1.5L6.5 18 9 17a8 8 0 0 0 1.4 1l.3 2.6h4L15 18a8 8 0 0 0 1.5-1l2.4 1 2-3.5-2-1.5a7 7 0 0 0 .1-1z" />
      </>
    ),
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
