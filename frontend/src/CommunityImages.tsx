import { useEffect, useMemo, useRef, useState } from "react";

type ContributionFile = { id: string; file: File; url: string; partNumber: string };
type SubmissionState = {
  submission: { id: string; status: string; imageCount: number; acceptedCount: number; rejectedCount: number; contributorCredit: string };
  images?: Array<{ id: string; partNumber: string; sourceFilename: string; status: string; error?: string; archiveFilename?: string }>;
};

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

export function CommunityImages({ maxImages, enabled, automatedReviewActive, gitArchiveConnected }: {
  maxImages: number;
  enabled: boolean;
  automatedReviewActive: boolean;
  gitArchiveConnected: boolean;
}) {
  const [files, setFiles] = useState<ContributionFile[]>([]);
  const [defaultPart, setDefaultPart] = useState("");
  const [credit, setCredit] = useState("");
  const [ownership, setOwnership] = useState(false);
  const [license, setLicense] = useState(false);
  const [contentRules, setContentRules] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<{ id: string; token: string } | null>(() => {
    try { return JSON.parse(localStorage.getItem("partquill_community_receipt") || "null") as { id: string; token: string } | null; }
    catch { return null; }
  });
  const [status, setStatus] = useState<SubmissionState | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<ContributionFile[]>([]);

  const ready = enabled && files.length > 0 && files.every((row) => row.partNumber.trim())
    && credit.trim().length >= 2 && ownership && license && contentRules && !busy;
  const uniqueParts = useMemo(() => new Set(files.map((row) => row.partNumber.trim().toUpperCase())).size, [files]);

  useEffect(() => { filesRef.current = files; }, [files]);
  useEffect(() => () => filesRef.current.forEach((row) => URL.revokeObjectURL(row.url)), []);

  useEffect(() => {
    if (!receipt) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`/v1/community/submissions/${receipt.id}?token=${encodeURIComponent(receipt.token)}`, { cache: "no-store" });
        if (!response.ok) throw new Error("Your contribution receipt could not be loaded.");
        const next = await response.json() as SubmissionState;
        if (!cancelled) setStatus(next);
        if (!cancelled && !["PUBLISHED","PARTIALLY_PUBLISHED","REJECTED","FAILED"].includes(next.submission.status)) window.setTimeout(poll, 5000);
      } catch (reason) { if (!cancelled) setError(reason instanceof Error ? reason.message : "Status check failed."); }
    };
    void poll();
    return () => { cancelled = true; };
  }, [receipt]);

  const addFiles = (selection: FileList | File[]) => {
    setError("");
    const incoming = Array.from(selection).filter((file) => ALLOWED.has(file.type));
    const room = Math.max(0, maxImages - files.length);
    if (!room) { setError(`This contribution already has ${maxImages} images.`); return; }
    const accepted = incoming.slice(0, room).map((file) => ({
      id: crypto.randomUUID(), file, url: URL.createObjectURL(file), partNumber: defaultPart.trim()
    }));
    setFiles((current) => [...current, ...accepted]);
    if (incoming.length > room) setError(`${incoming.length - room} image${incoming.length - room === 1 ? " was" : "s were"} over the ${maxImages}-image limit.`);
  };

  const remove = (id: string) => {
    setFiles((current) => {
      const target = current.find((row) => row.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return current.filter((row) => row.id !== id);
    });
  };

  const submit = async () => {
    if (!ready) return;
    setBusy(true); setError("");
    try {
      const form = new FormData();
      form.append("contributorCredit", credit.trim());
      form.append("partNumbers", JSON.stringify(files.map((row) => row.partNumber.trim())));
      form.append("ownershipConfirmed", "true");
      form.append("licenseConfirmed", "true");
      form.append("contentRulesConfirmed", "true");
      files.forEach((row) => form.append("images", row.file, row.file.name));
      const response = await fetch("/v1/community/submissions", { method: "POST", body: form });
      const payload = await response.json().catch(() => ({})) as { submission?: SubmissionState["submission"]; statusToken?: string; error?: { message?: string } };
      if (!response.ok || !payload.submission || !payload.statusToken) throw new Error(payload.error?.message || `Upload failed (${response.status}).`);
      const next = { id: payload.submission.id, token: payload.statusToken };
      localStorage.setItem("partquill_community_receipt", JSON.stringify(next));
      setReceipt(next);
      setStatus({ submission: payload.submission });
      files.forEach((row) => URL.revokeObjectURL(row.url));
      setFiles([]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The contribution could not be uploaded."); }
    finally { setBusy(false); }
  };

  return <section className="view community-view">
    <div className="community-hero">
      <div><span>PARTQUILL COMMUNITY IMAGE WIKI</span><h1>Help preserve a part<br/>before its photos disappear.</h1><p>Contribute owner-authorized part photographs. PartQuill screens them, checks each exact part number, performs the Ferrari-style white-background edit, and preserves approved references permanently by SKU.</p></div>
      <aside><strong>FREE</strong><span>Community archive</span><small>Up to {maxImages} images per contribution</small></aside>
    </div>

    <div className="community-trust-strip">
      <div><b>01</b><span><strong>Exact part number</strong><small>Required for every image</small></span></div>
      <div><b>02</b><span><strong>Rights attestation</strong><small>Owner or written permission</small></span></div>
      <div><b>03</b><span><strong>Two-stage review</strong><small>Automated screen + human check</small></span></div>
      <div><b>04</b><span><strong>Permanent SKU archive</strong><small>SKU, SKU_1, SKU_2…</small></span></div>
    </div>

    {receipt && status ? <div className="community-receipt">
      <header><div><span>CONTRIBUTION RECEIPT</span><h2>Thank you, {status.submission.contributorCredit}.</h2><p>Save this browser receipt. Your originals are quarantined and nothing becomes public before review.</p></div><b className={`community-status status-${status.submission.status.toLowerCase()}`}>{status.submission.status.replaceAll("_", " ")}</b></header>
      <div className="receipt-metrics"><span><strong>{status.submission.imageCount}</strong> submitted</span><span><strong>{status.submission.acceptedCount}</strong> accepted so far</span><span><strong>{status.submission.rejectedCount}</strong> rejected</span><span><strong>{status.images?.filter((row) => row.status === "PUBLISHED").length ?? 0}</strong> published</span></div>
      {status.images && <div className="receipt-files">{status.images.map((image) => <article key={image.id}><div><strong>{image.partNumber}</strong><span>{image.sourceFilename}</span></div><b>{image.status.replaceAll("_", " ")}</b>{image.archiveFilename && <code>{image.archiveFilename}</code>}{image.error && <small>{image.error}</small>}</article>)}</div>}
      <button className="secondary" onClick={() => { localStorage.removeItem("partquill_community_receipt"); setReceipt(null); setStatus(null); }}>Start another contribution</button>
    </div> : <div className="community-layout">
      <div className="community-uploader">
        <header><div><span>CONTRIBUTE PHOTOS</span><h2>Every image gets its own SKU key.</h2></div><b>{files.length}/{maxImages}</b></header>
        {!enabled && <div className="community-alert">Community intake is temporarily paused.</div>}
        <div className="community-fields">
          <label><span>Public contributor credit</span><input value={credit} maxLength={80} onChange={(event) => setCredit(event.target.value)} placeholder="Your name, shop, club or chosen alias"/><small>Shown as “Photo contributed by …” Email is not requested or displayed.</small></label>
          <label><span>Default part number</span><div><input value={defaultPart} maxLength={64} onChange={(event) => setDefaultPart(event.target.value)} placeholder="Example: 5455055"/><button type="button" onClick={() => setFiles((current) => current.map((row) => ({ ...row, partNumber: defaultPart.trim() })))}>Apply to all</button></div><small>You can change any individual image below.</small></label>
        </div>
        <div className="community-drop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addFiles(event.dataTransfer.files); }} onClick={() => inputRef.current?.click()}>
          <span className="community-camera">+</span><strong>Choose or drop part photos</strong><p>JPEG, PNG or WebP · 12 MB each · 100 MB total</p><button type="button">Select images</button><input ref={inputRef} type="file" hidden multiple accept="image/jpeg,image/png,image/webp" onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.currentTarget.value = ""; }}/>
        </div>
        {files.length > 0 && <div className="community-file-head"><span>{files.length} photos · {uniqueParts} part number{uniqueParts === 1 ? "" : "s"}</span><button type="button" onClick={() => { files.forEach((row) => URL.revokeObjectURL(row.url)); setFiles([]); }}>Remove all</button></div>}
        <div className="community-file-grid">{files.map((row, index) => <article key={row.id}>
          <div className="community-thumb"><img src={row.url} alt={`Selected contribution ${index + 1}`}/><span>{index + 1}</span><button type="button" aria-label={`Remove ${row.file.name}`} onClick={() => remove(row.id)}>×</button></div>
          <label><span>Exact part number</span><input value={row.partNumber} maxLength={64} onChange={(event) => setFiles((current) => current.map((item) => item.id === row.id ? { ...item, partNumber: event.target.value } : item))} placeholder="Required"/></label>
          <small>{row.file.name} · {(row.file.size / 1_048_576).toFixed(1)} MB</small>
        </article>)}</div>
      </div>

      <aside className="community-rules">
        <div className="rules-title"><span>PQ</span><div><strong>Archive rules</strong><small>Fail closed, every time</small></div></div>
        <ul><li className="allow">Actual part, label, packaging or a genuinely different angle</li><li className="allow">Physical product markings remain untouched</li><li className="deny">No people, faces, hands, arms or body parts</li><li className="deny">No eBay-style promotions, banners, overlays or watermarks</li><li className="deny">No explicit, illegal, unsafe or unrelated content</li><li className="deny">No repeated copy of the same view</li></ul>
        <div className="community-legal">
          <label><input type="checkbox" checked={ownership} onChange={(event) => setOwnership(event.target.checked)}/><span><strong>I own these photos or have written permission.</strong><small>I am authorized to grant the license below.</small></span></label>
          <label><input type="checkbox" checked={license} onChange={(event) => setLicense(event.target.checked)}/><span><strong>I grant PartQuill a non-exclusive, worldwide, royalty-free license.</strong><small>PartQuill may store, edit, publish, display and redistribute these photos as part-reference media, with contributor credit.</small></span></label>
          <label><input type="checkbox" checked={contentRules} onChange={(event) => setContentRules(event.target.checked)}/><span><strong>I confirm every image follows the archive rules.</strong><small>Rejected or abusive uploads are not published.</small></span></label>
        </div>
        {error && <div className="community-error" role="alert">{error}</div>}
        <button className="community-submit" disabled={!ready} onClick={() => void submit()}>{busy ? "Securing contribution…" : `Submit ${files.length || ""} image${files.length === 1 ? "" : "s"} for review`}</button>
        <p className="community-system-state"><i className={automatedReviewActive ? "on" : "off"}/>{automatedReviewActive ? "Automated image screening active" : "Automated screening awaiting activation"}<br/><i className={gitArchiveConnected ? "on" : "off"}/>{gitArchiveConnected ? "Permanent Git archive connected" : "Approved images will wait for permanent archive connection"}</p>
      </aside>
    </div>}
  </section>;
}
