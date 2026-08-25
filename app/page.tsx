import DialerDashboard from "./components/dialer-dashboard";
import { chatGPTSignInPath, getChatGPTUser } from "./chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  if (!user) return <main className="landing"><nav><div className="brand-name">APPOINTMENT SETTER</div><a className="button button-secondary" href={chatGPTSignInPath("/")}>Sign in</a></nav><section className="landing-hero"><span className="eyebrow">AI OUTREACH, WITH GUARDRAILS</span><h1>Turn consented prospects into booked conversations.</h1><p>Run human-sounding AI calls, qualify interest, and book confirmed appointments into Outlook or Google Calendar—from one secure multi-tenant workspace.</p><div><a className="button button-primary" href={chatGPTSignInPath("/")}>Start 14-day trial</a><span>Plans from $19.99/month</span></div></section><section className="landing-plans"><article><h2>Starter</h2><strong>$19.99</strong><p>250 calls monthly · 2 concurrent</p></article><article><h2>Growth</h2><strong>$49.99</strong><p>2,000 calls · 5 seats · 10 concurrent</p></article><article><h2>Pro</h2><strong>$99.99</strong><p>10,000 calls · 20 seats · 20 concurrent</p></article></section><section className="legal-note"><p>Operators are responsible for consent, DNC, recording, caller-ID, and jurisdiction-specific telemarketing compliance. The AI clearly identifies itself.</p></section></main>;
  return (
    <DialerDashboard userName={user.displayName} userEmail={user.email} />
  );
}
