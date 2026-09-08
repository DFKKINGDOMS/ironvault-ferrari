import { useEffect, useRef, useState, type FormEvent } from "react";

type GoogleResult = {
  provider: "google_search";
  model: string;
  researched_at: string;
  answer_html: string;
  search_suggestions_html: string;
  source_count: number;
};
function GoogleAnswer({ result }: { result: GoogleResult }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const root = host.current.shadowRoot ?? host.current.attachShadow({ mode: "open" });
    root.innerHTML = '<style>:host{display:block;color:inherit;font:inherit}a{color:#8bc5ff}ol{padding-left:24px}sup a{margin-left:3px}section{margin-top:24px}</style>'
      + result.answer_html + '<section aria-label="Google Search suggestions">' + result.search_suggestions_html + '</section>';
  }, [result]);
  return <div ref={host}/>;
}
export function GoogleResearch({ onCatalogue }: { onCatalogue: (sku: string, vendor: string) => void }) {
  const [sku, setSku] = useState("");
  const [vendor, setVendor] = useState("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<GoogleResult | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    void fetch("/v1/seller-ui/google-research/status", { cache: "no-store" })
      .then(response => response.ok ? response.json() : null)
      .then((data: { configured?: boolean } | null) => setConfigured(data?.configured === true))
      .catch(() => setConfigured(false));
    return () => controller.current?.abort();
  }, []);
  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(""); setResult(null);
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const request_id = Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
    const abort = new AbortController();
    controller.current = abort;
    const timeout = window.setTimeout(() => abort.abort(), 250_000);
    try {
      const response = await fetch("/v1/seller-ui/google-research", {
        method: "POST", cache: "no-store", signal: abort.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sku: sku.trim(), vendor: vendor.trim(), question: question.trim(), request_id })
      });
      const data = await response.json() as GoogleResult & { error?: { message?: string } };
      if (!response.ok) throw new Error(data.error?.message ?? "Google research could not complete.");
      if (data.provider !== "google_search" || typeof data.answer_html !== "string") throw new Error("The Google research response was incomplete.");
      setResult(data);
    } catch (failure) {
      if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : "Google research could not complete.");
      else setError("This Google search timed out. You can start a new search.");
    } finally {
      window.clearTimeout(timeout);
      setBusy(false);
      controller.current = null;
    }
  }
  return <section className="view" aria-label="Part research">
    <div className="section-heading"><div><span className="eyebrow">Live part research</span><h1>Find documented fitment</h1><p>Search the public web with Google or look up the evidence in your own catalogue.</p></div></div>
    <form onSubmit={event => void search(event)} style={{ display: "grid", gap: 16, maxWidth: 900 }}>
      <div className="research-search">
        <label><span>Manufacturer</span><div><input value={vendor} onChange={event => setVendor(event.target.value)} maxLength={100} required placeholder="Manufacturer on the part or packaging" disabled={busy}/></div></label>
        <label><span>OEM part number</span><div><input value={sku} onChange={event => setSku(event.target.value)} minLength={2} maxLength={80} required placeholder="Exact part number" disabled={busy}/></div></label>
      </div>
      <label><span>What do you need to confirm? (optional)</span><textarea value={question} onChange={event => setQuestion(event.target.value)} maxLength={600} rows={2} placeholder="Models, years, engines, or a suspected supersession. Leave out full VINs." disabled={busy} style={{ width: "100%", padding: 12 }}/></label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <button className="primary" type="submit" disabled={busy || configured !== true}>{busy ? "Searching Google…" : "Research with Google"}</button>
        <button className="secondary" type="button" disabled={busy || !sku.trim()} onClick={() => onCatalogue(sku.trim(), vendor.trim())}>Search my catalogue</button>
      </div>
    </form>
    {configured === false && <p role="status">Google research is temporarily unavailable. Your catalogue search remains available.</p>}
    {busy && <p role="status" aria-live="polite">Searching exact part-number variants and checking cited catalogue evidence. You can leave this view open while it completes.</p>}
    {error && <p role="alert">{error}</p>}
    {result && <article className="research-result" style={{ marginTop: 24, padding: 24, lineHeight: 1.65 }}>
      <header style={{ marginBottom: 20 }}><strong>Google Search research</strong><p>Review the cited evidence and exact vehicle restrictions before relying on a fitment claim.</p></header>
      <GoogleAnswer result={result}/>
    </article>}
  </section>;
}
