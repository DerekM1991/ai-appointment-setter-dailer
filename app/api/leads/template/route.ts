import { getAuthorizedApiUser } from "@/lib/api-auth";

const header = [
  "first_name",
  "last_name",
  "company",
  "title",
  "phone",
  "email",
  "timezone",
  "state",
  "country_code",
  "consent_status",
  "consent_timestamp",
  "consent_source",
  "consent_evidence",
  "dnc_checked_at",
  "internal_dnc",
  "notes",
].join(",");

export async function GET() {
  const auth = await getAuthorizedApiUser();
  if (!auth.ok) return auth.response;
  return new Response(`${header}\n`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="odin-prospect-import-template.csv"',
      "cache-control": "no-store",
    },
  });
}
