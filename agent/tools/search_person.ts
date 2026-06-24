import { defineTool } from "eve/tools";
import { z } from "zod";

/**
 * search_person — aggregate publicly available information about a person.
 *
 * This utility queries free, no-key public sources (Wikipedia and the
 * DuckDuckGo Instant Answer API) for a biographical overview, and then builds
 * a set of categorized follow-up search leads (professional, code, social,
 * news, web) the agent can dig into with the built-in `web_fetch` /
 * `web_search` tools.
 *
 * It only surfaces information that is already public. It does not scrape
 * private data, bypass logins, or guess contact details. Use it for legitimate
 * purposes (research, journalism, due diligence) and respect applicable privacy
 * laws and each source's terms.
 */

const Source = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
});

const Lead = z.object({
  category: z.string(),
  query: z.string(),
  url: z.string(),
});

const outputSchema = z.object({
  name: z.string(),
  context: z.string().nullable(),
  summary: z.string().nullable(),
  summarySource: z.string().nullable(),
  sources: z.array(Source),
  searchLeads: z.array(Lead),
  warnings: z.array(z.string()),
});

type Output = z.infer<typeof outputSchema>;

const USER_AGENT =
  "eve-agent-search_person/1.0 (+https://github.com/vercel/eve; public-info aggregator)";

/** Fetch JSON with a timeout; returns null and records a warning on failure. */
async function fetchJson(
  url: string,
  warnings: string[],
  label: string,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      warnings.push(`${label}: HTTP ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    warnings.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function stripHtml(input: string): string {
  return input
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

interface WikiSearchResponse {
  query?: { search?: Array<{ title?: string; snippet?: string }> };
}

interface WikiSummaryResponse {
  extract?: string;
  description?: string;
  content_urls?: { desktop?: { page?: string } };
}

interface DuckDuckGoResponse {
  Heading?: string;
  AbstractText?: string;
  AbstractURL?: string;
  RelatedTopics?: Array<{
    Text?: string;
    FirstURL?: string;
    Topics?: Array<{ Text?: string; FirstURL?: string }>;
  }>;
}

async function queryWikipedia(
  query: string,
  sources: Output["sources"],
  warnings: string[],
): Promise<{ summary: string; source: string } | null> {
  const searchUrl =
    "https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*" +
    `&list=search&srlimit=3&srsearch=${encodeURIComponent(query)}`;
  const search = (await fetchJson(searchUrl, warnings, "wikipedia.search")) as
    | WikiSearchResponse
    | null;
  const hits = search?.query?.search ?? [];
  if (hits.length === 0) return null;

  for (const hit of hits) {
    if (hit.snippet && hit.title) {
      sources.push({
        title: hit.title,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, "_"))}`,
        snippet: stripHtml(hit.snippet),
      });
    }
  }

  const topTitle = hits[0]?.title;
  if (!topTitle) return null;
  const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
    topTitle.replace(/ /g, "_"),
  )}`;
  const summary = (await fetchJson(summaryUrl, warnings, "wikipedia.summary")) as
    | WikiSummaryResponse
    | null;
  const extract = summary?.extract?.trim();
  if (!extract) return null;
  return {
    summary: extract,
    source: summary?.content_urls?.desktop?.page ?? summaryUrl,
  };
}

async function queryDuckDuckGo(
  query: string,
  sources: Output["sources"],
  warnings: string[],
): Promise<{ summary: string; source: string } | null> {
  const url =
    "https://api.duckduckgo.com/?format=json&no_html=1&skip_disambig=1" +
    `&q=${encodeURIComponent(query)}`;
  const data = (await fetchJson(url, warnings, "duckduckgo")) as
    | DuckDuckGoResponse
    | null;
  if (!data) return null;

  const related = data.RelatedTopics ?? [];
  for (const topic of related.slice(0, 8)) {
    const flat = topic.Topics ? topic.Topics : [topic];
    for (const t of flat) {
      if (t.Text && t.FirstURL) {
        sources.push({ title: t.Text.split(" - ")[0] ?? t.Text, url: t.FirstURL, snippet: t.Text });
      }
    }
  }

  const abstract = data.AbstractText?.trim();
  if (abstract && data.AbstractURL) {
    return { summary: abstract, source: data.AbstractURL };
  }
  return null;
}

function buildLeads(name: string, context: string | null): Output["searchLeads"] {
  const base = context ? `${name} ${context}` : name;
  const enc = (s: string) => encodeURIComponent(s);
  return [
    {
      category: "web",
      query: base,
      url: `https://duckduckgo.com/?q=${enc(base)}`,
    },
    {
      category: "professional",
      query: `${base} site:linkedin.com`,
      url: `https://duckduckgo.com/?q=${enc(`${base} site:linkedin.com/in`)}`,
    },
    {
      category: "code",
      query: `${name} GitHub`,
      url: `https://github.com/search?type=users&q=${enc(name)}`,
    },
    {
      category: "social",
      query: `${base} (twitter OR x.com)`,
      url: `https://duckduckgo.com/?q=${enc(`${base} site:x.com OR site:twitter.com`)}`,
    },
    {
      category: "news",
      query: `${base} news`,
      url: `https://news.google.com/search?q=${enc(base)}`,
    },
  ];
}

export default defineTool({
  description:
    "Search publicly available information about a person and return a biographical overview plus categorized follow-up search leads. Aggregates free public sources (Wikipedia, DuckDuckGo). Surfaces only already-public info; use the returned leads with web_fetch/web_search to go deeper.",
  inputSchema: z.object({
    name: z.string().min(1).describe("Full name of the person to research."),
    context: z
      .string()
      .optional()
      .describe(
        "Optional disambiguating context, e.g. employer, location, or role ('Vercel CTO', 'Berlin').",
      ),
  }),
  outputSchema,
  async execute({ name, context }): Promise<Output> {
    const ctx = context?.trim() ? context.trim() : null;
    const query = ctx ? `${name} ${ctx}` : name;

    const sources: Output["sources"] = [];
    const warnings: string[] = [];

    const [wiki, ddg] = await Promise.all([
      queryWikipedia(query, sources, warnings),
      queryDuckDuckGo(query, sources, warnings),
    ]);

    const chosen = wiki ?? ddg;

    // De-duplicate sources by URL.
    const seen = new Set<string>();
    const deduped = sources.filter((s) => {
      if (seen.has(s.url)) return false;
      seen.add(s.url);
      return true;
    });

    if (!chosen && deduped.length === 0) {
      warnings.push(
        "No public records were retrieved. The person may be non-notable or the sources were unreachable; follow the searchLeads with web_search/web_fetch.",
      );
    }

    return {
      name,
      context: ctx,
      summary: chosen?.summary ?? null,
      summarySource: chosen?.source ?? null,
      sources: deduped.slice(0, 12),
      searchLeads: buildLeads(name, ctx),
      warnings,
    };
  },

  // Keep the model's view concise; channels still receive the full object.
  toModelOutput(output) {
    const lines: string[] = [`Person: ${output.name}${output.context ? ` (${output.context})` : ""}`];
    if (output.summary) {
      lines.push(`\nOverview (${output.summarySource ?? "source"}):\n${output.summary}`);
    } else {
      lines.push("\nNo biographical summary found in public sources.");
    }
    if (output.sources.length > 0) {
      lines.push(
        "\nSources:\n" +
          output.sources.map((s) => `- ${s.title}: ${s.url}`).join("\n"),
      );
    }
    lines.push(
      "\nFollow-up leads:\n" +
        output.searchLeads.map((l) => `- [${l.category}] ${l.url}`).join("\n"),
    );
    if (output.warnings.length > 0) {
      lines.push("\nWarnings:\n" + output.warnings.map((w) => `- ${w}`).join("\n"));
    }
    return { type: "text", value: lines.join("\n") };
  },
});
