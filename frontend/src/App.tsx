"use client";

import { useEffect, useMemo, useState } from "react";

type SellerBootstrap = {
  version: string;
  mode: string;
  backendConnected: boolean;
  ebay: { environment: string; mode: string; writesEnabled: boolean; handoffUrl: string };
  persistence: string;
  imageStudio: { mode: string; path: string };
};

type SellerPreview = {
  status: "ILLUSTRATIVE_SAMPLE" | "HELD" | "PHOTO_REQUIRED" | "SAFETY_REVIEW_REQUIRED";
  intent: {
    partNumber: string | null;
    itemDescription: string | null;
    route: "CATALOG_ASSISTED" | "PHOTO_FIRST" | "SAFETY_REVIEW";
    safetyClass: "STANDARD" | "RESTRAINT_SYSTEM";
    price: string | null;
    quantity: number;
    condition: "New" | "Used" | "Remanufactured" | "Not specified";
    shipping: "Seller default" | "Free domestic shipping" | "Calculated shipping" | "Local pickup only";
    fitmentMode: "CATALOG_CONTROLLED" | "DO_NOT_PUBLISH";
  };
  listing: {
    title: string;
    titleLength: number;
    format: string;
    sku: string | null;
    description: string;
    category: string | null;
    aspects: Record<string, string>;
    handlingTime: string;
    returns: string;
    international: string;
  };
  identity: {
    state: "ILLUSTRATIVE_NOT_EVIDENCE" | "NOT_VERIFIED" | "PHOTO_IDENTIFICATION_PENDING" | "SAFETY_REVIEW_PENDING";
    brand: string | null;
    manufacturerPartNumber: string | null;
    productType: string | null;
    sourceLabel: string;
    sourceDetail: string;
  };
  fitment: {
    state: "NOT_VERIFIED" | "OMITTED_BY_SELLER";
    totalApplications: number;
    sourceLabel: string;
    sourceDetail: string;
    applications: Array<{ vehicle: string; qualifier: string; state: "NOT_VERIFIED" }>;
  };
  media: {
    state: "SELLER_PHOTO_REQUIRED" | "LABEL_AND_PHOTOS_REQUIRED";
    sourceLabel: string;
    sourceDetail: string;
    minimumPhotos: number;
    requiredViews: Array<{ id: string; label: string; detail: string; required: boolean }>;
    analysisState: "NOT_UPLOADED";
  };
  confirmations: Array<{ id: string; label: string; detail: string }>;
  issues: Array<{ code: string; message: string; blocking: boolean }>;
  recovery: { label: string; enabled: boolean; privacyNote: string };
  policy: {
    state: "STANDARD_REVIEW" | "RESTRICTED_ITEM_HOLD";
    label: string;
    sourceUrl: string | null;
    requirements: string[];
  };
  gates: { privatePreflight: "SIMULATION_AVAILABLE" | "HELD"; publicEbayWrite: "DISABLED"; ebayHandoffUrl: string };
  noExternalRequestMade: true;
  fingerprint: string;
};

type View =
  | "instant"
  | "inventory"
  | "new"
  | "research"
  | "drafts"
  | "review"
  | "ready"
  | "published"
  | "risk"
  | "evidence"
  | "settings";

type EditorTab =
  | "listing"
  | "identity"
  | "condition"
  | "fitment"
  | "images"
  | "shipping"
  | "pricing"
  | "policies"
  | "preview";

type Tone = "green" | "amber" | "red" | "slate" | "orange";
type IconName = "inventory" | "plus" | "search" | "edit" | "shield" | "check" | "live" | "alert" | "receipt" | "settings" | "camera" | "box" | "truck" | "money" | "link" | "arrow" | "more";

type StagedPhoto = { name: string; url: string };

const navGroups: Array<{ label: string; items: Array<{ id: View; label: string; icon: IconName; count?: number }> }> = [
  {
    label: "Start here",
    items: [
      { id: "instant", label: "List a part", icon: "plus" },
      { id: "inventory", label: "Inventory", icon: "inventory" },
      { id: "drafts", label: "Draft listings", icon: "edit", count: 8 },
    ],
  },
  {
    label: "Manage",
    items: [
      { id: "review", label: "Approvals", icon: "shield", count: 7 },
      { id: "published", label: "Published", icon: "live", count: 11 },
      { id: "risk", label: "Risk & returns", icon: "alert", count: 3 },
    ],
  },
  {
    label: "Extra tools",
    items: [
      { id: "new", label: "Guided listing", icon: "camera" },
      { id: "research", label: "Research only", icon: "search" },
      { id: "evidence", label: "Evidence Packs", icon: "receipt" },
      { id: "settings", label: "Settings", icon: "settings" },
    ],
  },
];

const inventoryRows = [
  { part: "13568-29025", description: "Toyota timing belt", sku: "VLT-1042", condition: "New", qty: 1, price: "$79.95", status: "Draft", tone: "amber" as Tone, updated: "2m ago", next: "Review fitment" },
  { part: "90915-YZZD1", description: "Toyota oil filter", sku: "VLT-1041", condition: "New", qty: 12, price: "$12.95", status: "Ready", tone: "green" as Tone, updated: "18m ago", next: "Public approval" },
  { part: "997-347-804", description: "Steering rack assembly", sku: "VLT-1038", condition: "Reman", qty: 1, price: "$199.95", status: "Held", tone: "amber" as Tone, updated: "1h ago", next: "Add core terms" },
  { part: "F3TZ-15200", description: "Front lamp assembly", sku: "VLT-1034", condition: "Used", qty: 1, price: "$72.60", status: "Held", tone: "amber" as Tone, updated: "3h ago", next: "Confirm side" },
  { part: "AIR-7210", description: "Restraint inflator component", sku: "VLT-1029", condition: "Used", qty: 1, price: "—", status: "Blocked", tone: "red" as Tone, updated: "Yesterday", next: "Restricted item" },
  { part: "204070037", description: "BRP latch base", sku: "VLT-1018", condition: "New", qty: 4, price: "$44.95", status: "Published", tone: "slate" as Tone, updated: "2d ago", next: "Healthy" },
];

const evidenceMeters = [
  { label: "Identity", value: 100, state: "Confirmed", tone: "green" as Tone, detail: "Brand + MPN seller confirmed" },
  { label: "Condition", value: 100, state: "Confirmed", tone: "green" as Tone, detail: "New old stock; packaging photographed" },
  { label: "Fitment", value: 58, state: "Not claimed", tone: "amber" as Tone, detail: "Potential catalog applications excluded" },
  { label: "Shipping", value: 86, state: "Domestic ready", tone: "green" as Tone, detail: "International held pending origin" },
  { label: "Image rights", value: 100, state: "Confirmed", tone: "green" as Tone, detail: "Seller-owned originals retained" },
];

const compatibilityRows = [
  { application: "1997–2003 Lexus ES300 · 3.0L V6", source: "Catalog reference", status: "Potential only", tone: "amber" as Tone },
  { application: "1999–2003 Lexus RX300 · 3.0L V6", source: "Catalog reference", status: "Potential only", tone: "amber" as Tone },
  { application: "1997–2004 Toyota Avalon · 3.0L V6", source: "Catalog reference", status: "Potential only", tone: "amber" as Tone },
  { application: "1997–2006 Toyota Camry · V6", source: "Catalog reference", status: "Potential only", tone: "amber" as Tone },
];

const imageRoles = [
  { role: "Hero", label: "Whole item", state: "Approved derivative", tone: "green" as Tone, note: "Original retained" },
  { role: "Label", label: "MPN face", state: "Original", tone: "green" as Tone, note: "Text readable" },
  { role: "Reverse", label: "Back / teeth", state: "Original", tone: "green" as Tone, note: "Complete item shown" },
  { role: "Package", label: "OEM packaging", state: "Original", tone: "green" as Tone, note: "Condition evidence" },
  { role: "Defect", label: "Damage close-up", state: "Not required", tone: "slate" as Tone, note: "Seller confirmed none" },
];

const itemSpecifics = [
  { field: "Brand", value: "Toyota", source: "Seller confirmed", tone: "green" as Tone },
  { field: "Manufacturer Part Number", value: "13568-29025", source: "Label + exact lookup", tone: "green" as Tone },
  { field: "OE/OEM Part Number", value: "13568-29025", source: "Seller confirmed", tone: "green" as Tone },
  { field: "Superseded by", value: "13568-YZZ10", source: "Reference only", tone: "amber" as Tone },
  { field: "Type", value: "Timing Belt", source: "Exact identity", tone: "green" as Tone },
  { field: "Country of Origin", value: "Unknown", source: "Not provided", tone: "amber" as Tone },
];

const exceptionRows = [
  { tone: "red" as Tone, level: "BLOCK", title: "Restricted restraint component", sku: "AIR-7210", action: "Keep blocked", detail: "Airbag, inflator or pretensioner terminology excludes this item from every publish set." },
  { tone: "amber" as Tone, level: "HOLD", title: "Fitment is intentionally unclaimed", sku: "VLT-1042", action: "Review fitment", detail: "Broad applications exist, but no permitted source supports a public compatibility claim yet." },
  { tone: "amber" as Tone, level: "HOLD", title: "Left or right side unresolved", sku: "VLT-1034", action: "Confirm side", detail: "The lamp draft cannot claim a vehicle position until seller or catalog evidence resolves it." },
  { tone: "orange" as Tone, level: "DRIFT", title: "Required category aspect changed", sku: "VLT-1011", action: "Prepare revision", detail: "A live listing needs one new required aspect before its next material revision." },
];

const publishDiff = [
  { field: "Title", before: "Toyota Timing Belt 13568-29025", after: "New Genuine Toyota Timing Belt 13568-29025 OEM", state: "Seller edit" },
  { field: "Price", before: "$74.95", after: "$79.95", state: "Seller edit" },
  { field: "Compatibility", before: "4 potential groups", after: "No public rows", state: "Risk reduced" },
  { field: "Images", before: "3 originals", after: "4 originals + 1 approved hero", state: "Evidence added" },
  { field: "International", before: "On", after: "Off — origin unknown", state: "Policy hold" },
];

const publishedRows = [
  { sku: "VLT-1018", listing: "BRP Latch Base 204070037", price: "$44.95", qty: 4, views: 39, status: "Healthy", reconciled: "8m ago" },
  { sku: "VLT-1009", listing: "Porsche Oil Filter OX-171D", price: "$18.42", qty: 8, views: 112, status: "Remote drift", reconciled: "31m ago" },
  { sku: "VLT-1003", listing: "Ferrari Body Panel Bracket", price: "$289.00", qty: 1, views: 76, status: "Healthy", reconciled: "1h ago" },
];

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    inventory: <><path d="M4 4h16v5H4zM4 12h16v8H4z"/><path d="M8 6.5h5M8 15h8"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    search: <><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></>,
    edit: <><path d="M5 19h4l10-10-4-4L5 15v4Z"/><path d="m13 7 4 4"/></>,
    shield: <><path d="M12 3 5 6v5c0 4.5 2.7 7.7 7 10 4.3-2.3 7-5.5 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-5"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    live: <><path d="M5 12a7 7 0 0 1 12-5M19 12a7 7 0 0 1-12 5"/><path d="m15 4 2 3-3 1M9 20l-2-3 3-1"/></>,
    alert: <><path d="m12 3 9 17H3L12 3Z"/><path d="M12 9v5M12 17h.01"/></>,
    receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6M9 16h3"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/></>,
    camera: <><path d="M4 7h4l2-3h4l2 3h4v12H4V7Z"/><circle cx="12" cy="13" r="4"/></>,
    box: <><path d="m4 7 8-4 8 4-8 4-8-4Z"/><path d="M4 7v10l8 4 8-4V7M12 11v10"/></>,
    truck: <><path d="M3 6h11v10H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></>,
    money: <><circle cx="12" cy="12" r="9"/><path d="M15 8.5c-.7-.7-1.8-1-3-1-1.7 0-3 .8-3 2s1.3 1.8 3 2c1.7.2 3 1 3 2.2 0 1.3-1.3 2.3-3 2.3-1.3 0-2.4-.4-3.2-1.2M12 5v14"/></>,
    link: <><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/></>,
    arrow: <path d="m9 5 7 7-7 7"/>,
    more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  };
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function Badge({ tone = "slate", children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

function SectionHeading({ eyebrow, title, body, action }: { eyebrow: string; title: string; body?: string; action?: React.ReactNode }) {
  return <div className="section-heading"><div><span>{eyebrow}</span><h2>{title}</h2>{body && <p>{body}</p>}</div>{action}</div>;
}

function EvidenceMeters() {
  return <div className="evidence-meters">{evidenceMeters.map((item) => <article key={item.label}><div><span>{item.label}</span><Badge tone={item.tone}>{item.state}</Badge></div><i><b className={`meter-${item.tone}`} style={{ width: `${item.value}%` }} /></i><small>{item.detail}</small></article>)}</div>;
}

export default function Home() {
  const [view, setView] = useState<View>("instant");
  const [editorTab, setEditorTab] = useState<EditorTab>("listing");
  const [inventoryFilter, setInventoryFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [title, setTitle] = useState("New Genuine Toyota Timing Belt 13568-29025 OEM");
  const [price, setPrice] = useState("79.95");
  const [quantity, setQuantity] = useState("1");
  const [fitmentIncluded, setFitmentIncluded] = useState(false);
  const [domestic, setDomestic] = useState(true);
  const [international, setInternational] = useState(false);
  const [pickup, setPickup] = useState(false);
  const [preflightApproved, setPreflightApproved] = useState(false);
  const [publicApproved, setPublicApproved] = useState(false);
  const [feeFresh, setFeeFresh] = useState(false);
  const [notice, setNotice] = useState("");
  const [sellerContract, setSellerContract] = useState(true);
  const [quietHours, setQuietHours] = useState(false);
  const [captureMode, setCaptureMode] = useState<"part" | "barcode" | "csv" | "held">("part");
  const [instantCommand, setInstantCommand] = useState("List part 58487514 on eBay for $9.99 now");
  const [instantPrice, setInstantPrice] = useState("9.99");
  const [instantBuilt, setInstantBuilt] = useState(true);
  const [instantCondition, setInstantCondition] = useState("New");
  const [instantQuantity, setInstantQuantity] = useState("1");
  const [instantShipping, setInstantShipping] = useState("Seller default");
  const [instantFitmentMode, setInstantFitmentMode] = useState("Catalogue controlled");
  const [instantPartConfirmed, setInstantPartConfirmed] = useState(false);
  const [instantConditionConfirmed, setInstantConditionConfirmed] = useState(false);
  const [instantPreview, setInstantPreview] = useState<SellerPreview | null>(null);
  const [instantLoading, setInstantLoading] = useState(false);
  const [instantDirty, setInstantDirty] = useState(false);
  const [bootstrap, setBootstrap] = useState<SellerBootstrap | null>(null);
  const [instantPhotos, setInstantPhotos] = useState<StagedPhoto[]>([]);
  const [foundPartNumber, setFoundPartNumber] = useState("");

  const filteredRows = useMemo(() => inventoryRows.filter((row) => {
    const statusMatch = inventoryFilter === "All" || (inventoryFilter === "Needs action" ? ["Held", "Blocked"].includes(row.status) : row.status === inventoryFilter);
    const textMatch = `${row.part} ${row.description} ${row.sku}`.toLowerCase().includes(search.toLowerCase());
    return statusMatch && textMatch;
  }), [inventoryFilter, search]);

  const navigate = (next: View) => { setView(next); setNotice(""); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const openDraft = (tab: EditorTab = "listing") => { setEditorTab(tab); navigate("drafts"); };
  const showNotice = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(""), 4200); };
  const stageInstantPhotos = (files: FileList | null) => {
    const selected = Array.from(files ?? []).filter((file) => file.type.startsWith("image/")).slice(0, 8);
    if (!selected.length) return;
    void Promise.all(selected.map((file) => new Promise<StagedPhoto>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, url: String(reader.result) });
      reader.onerror = () => reject(reader.error ?? new Error("Photo preview failed"));
      reader.readAsDataURL(file);
    }))).then((photos) => {
      setInstantPhotos(photos);
      showNotice(`${photos.length} photo${photos.length === 1 ? "" : "s"} staged in this browser. Nothing was uploaded or sent to eBay.`);
    }).catch(() => showNotice("One or more photo previews could not be opened."));
  };
  const rebuildWithFoundPartNumber = () => {
    const found = foundPartNumber.trim();
    if (!found) {
      showNotice("Enter the number exactly as it appears on the item or label.");
      return;
    }
    const nextCommand = `${instantCommand.trim()}, part number ${found}`;
    setInstantCommand(nextCommand);
    void buildInstantDraft(nextCommand);
  };
  const buildInstantDraft = async (command = instantCommand) => {
    setInstantLoading(true);
    setInstantBuilt(false);
    try {
      const response = await fetch("/v1/seller-ui/command-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command })
      });
      if (!response.ok) throw new Error(`Preview request failed (${response.status})`);
      const payload = await response.json() as { preview: SellerPreview };
      const preview = payload.preview;
      setInstantPreview(preview);
      setInstantPrice(preview.intent.price ?? "");
      setInstantCondition(preview.intent.condition);
      setInstantQuantity(String(preview.intent.quantity));
      setInstantShipping(preview.intent.shipping);
      setInstantFitmentMode(preview.intent.fitmentMode === "DO_NOT_PUBLISH" ? "Do not publish fitment" : "Catalogue controlled");
      setInstantPartConfirmed(false);
      setInstantConditionConfirmed(false);
      setInstantDirty(false);
      setInstantPhotos([]);
      setFoundPartNumber("");
      setTitle(preview.listing.title);
      setPrice(preview.intent.price ?? "0.00");
      setQuantity(String(preview.intent.quantity));
      setInstantBuilt(true);
      showNotice(preview.status === "ILLUSTRATIVE_SAMPLE"
        ? "Backend preview built. The filled catalog state is clearly marked illustrative and no external request was made."
        : preview.status === "PHOTO_REQUIRED"
          ? "No part number is required. PartQuill switched this draft to the photo-first path."
          : preview.status === "SAFETY_REVIEW_REQUIRED"
            ? "Potential restraint item detected. Listing assembly is held for label, eligibility and safety evidence."
            : "Command understood. Unsupported identity and fitment claims are held until a unique authorized catalog match exists.");
    } catch (error) {
      setInstantPreview(null);
      setInstantBuilt(false);
      showNotice(error instanceof Error ? error.message : "The command preview could not be built.");
    } finally {
      setInstantLoading(false);
    }
  };

  useEffect(() => {
    void fetch("/v1/seller-ui/bootstrap")
      .then(async (response) => {
        if (!response.ok) throw new Error("bootstrap unavailable");
        setBootstrap(await response.json() as SellerBootstrap);
      })
      .catch(() => setBootstrap(null));
    void buildInstantDraft("List part 58487514 on eBay for $9.99 now");
    // The approved sample is bootstrapped once; later builds are seller-initiated.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const instantSample = instantPreview?.status === "ILLUSTRATIVE_SAMPLE";
  const instantPhotoFirst = instantPreview?.status === "PHOTO_REQUIRED";
  const instantSafety = instantPreview?.status === "SAFETY_REVIEW_REQUIRED";
  const instantCatalogRoute = instantPreview?.intent.route === "CATALOG_ASSISTED";
  const instantHeld = Boolean(instantPreview && !instantSample);
  const instantReady = Boolean(
    instantPartConfirmed
    && instantConditionConfirmed
    && !instantDirty
    && instantPreview?.gates.privatePreflight === "SIMULATION_AVAILABLE"
  );
  const instantTitle = instantPreview?.listing.title ?? "Listing evidence required";
  const instantItemLabel = instantPreview?.intent.partNumber
    ? `Part ${instantPreview.intent.partNumber}`
    : instantPreview?.intent.itemDescription ?? "Unidentified automotive item";
  const instantStatusHeading = instantSafety
    ? "Held — safety evidence required"
    : instantPhotoFirst
      ? instantPhotos.length
        ? "Photos staged — review not connected yet"
        : "Waiting for item photos"
      : instantHeld
        ? "Held — catalog match required"
        : instantDirty
          ? "Rebuild required"
          : "2 confirms left";
  const instantStatusCopy = instantSafety
    ? "Potential airbag or restraint terminology triggered eBay eligibility, donor-VIN, recall and hazmat checks."
    : instantPhotoFirst
      ? "A part number is optional. Add actual-item photos; PartQuill will keep identity and fitment blank until they can be supported."
      : instantHeld
        ? "The command was understood, but unsupported identity, fitment and media claims remain blocked."
        : "Seller defaults are filled; the physical item still needs confirmation.";
  const instantStages = instantSafety
    ? [
        ["01", "Understand", "Item + price extracted", true],
        ["02", "Route", "Safety review selected", true],
        ["03", "Resolve", "OEM label + donor VIN", false],
        ["04", "Protect", "Restricted-item hold", false],
        ["05", "Assemble", "Blocked pending evidence", false],
        ["06", "Review", "Requirements visible", true]
      ] as const
    : instantPhotoFirst
      ? [
          ["01", "Understand", "Item + price extracted", true],
          ["02", "Route", "Photo-first selected", true],
          ["03", "Resolve", "Waiting for photos", false],
          ["04", "Protect", "Fitment left blank", true],
          ["05", "Assemble", "After item review", false],
          ["06", "Review", "Missing evidence visible", true]
        ] as const
      : [
          ["01", "Understand", "Part + price extracted", true],
          ["02", "Resolve", instantHeld ? "Identity held" : "Identity state returned", !instantHeld],
          ["03", "Map", instantHeld ? "Awaiting category" : "Category + aspects", !instantHeld],
          ["04", "Protect", "Fitment + policy", true],
          ["05", "Assemble", "Media + description", !instantHeld],
          ["06", "Review", "Exceptions visible", true]
        ] as const;

  return (
    <div className="seller-app">
      <aside className="app-sidebar">
        <a className="brand" href="#main" onClick={(event) => { event.preventDefault(); navigate("instant"); }}>
          <span className="brand-scan"><b>PQ</b><i /><i /></span>
          <span><strong>PartQuill</strong><small>Seller workspace</small></span>
        </a>
        <button className="new-listing-side" onClick={() => navigate("instant")}><Icon name="plus" /> List a part</button>
        <nav aria-label="Seller workspace navigation">
          {navGroups.map((group) => <div className="nav-group" key={group.label}><span className="nav-label">{group.label}</span>{group.items.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} aria-current={view === item.id ? "page" : undefined} onClick={() => navigate(item.id)}><Icon name={item.icon} /><span>{item.label}</span>{item.count !== undefined && <b>{item.count}</b>}</button>)}</div>)}
        </nav>
        <div className="side-allowance"><div><span>Free Launch allowance</span><strong>7 of 10 left</strong></div><i><b /></i><small>Only successful public listings count.</small></div>
        <div className="side-account"><span>KW</span><div><strong>Kurt White</strong><small>Owner · Demo seller</small></div><Icon name="more" /></div>
      </aside>

      <main id="main" className="app-main">
        <header className="app-topbar">
          <div><span className="mobile-brand">PARTQUILL</span><small>One-command seller workspace</small><strong>Describe it. Review it. Submit it.</strong></div>
          <div className="topbar-actions"><span className="connection"><i /> {bootstrap?.backendConnected ? `Backend connected · v${bootstrap.version}` : "Connecting backend…"}</span><button onClick={() => navigate("risk")}><Icon name="alert" /> 3 actions</button><button onClick={() => navigate("settings")} aria-label="Open settings"><Icon name="settings" /></button></div>
        </header>

        {notice && <div className="toast" role="status"><Icon name="check" /><span>{notice}</span></div>}

        {view === "instant" && <section className="view instant-view">
          <div className="instant-intro">
            <div><span>PARTQUILL · PRIMARY SELLER ACTION</span><h1>What do you want to list?</h1><p>One instruction creates the complete seller draft. PartQuill fills everything it can prove and asks only for what it cannot.</p></div>
            <Badge tone={bootstrap?.backendConnected ? "green" : "slate"}>{bootstrap?.backendConnected ? "Private pilot · backend connected" : "Connecting"}</Badge>
          </div>

          <div className="command-deck">
            <span className="command-corner command-corner-a"/><span className="command-corner command-corner-b"/><span className="command-corner command-corner-c"/><span className="command-corner command-corner-d"/>
            <div className="command-label"><span className="command-mark">PQ</span><div><strong>Tell PartQuill exactly what to do</strong><small>Use a part number or describe the item. Include your price and any instructions.</small></div></div>
            <div className="command-input-row">
              <textarea aria-label="Instant listing command" value={instantCommand} onChange={(event) => setInstantCommand(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void buildInstantDraft(); } }}/>
              <button disabled={instantLoading} onClick={() => void buildInstantDraft()}>{instantLoading ? "Building safely…" : "Build my listing"} <Icon name={instantLoading ? "more" : "arrow"}/></button>
            </div>
            <div className="command-tools"><div><button onClick={() => navigate("new")}><Icon name="camera"/> Add item photos</button><button onClick={() => showNotice("Barcode and label scanning remain supporting evidence; they cannot establish fitment alone.")}><Icon name="search"/> Scan a label</button><button onClick={() => navigate("settings")}><Icon name="settings"/> Seller defaults</button></div><span>Press Enter to build · Shift + Enter for a new line</span></div>
            {instantBuilt && <div className="command-extracted" aria-label="Extracted listing intent">
              <span>PartQuill heard</span>
              {instantPreview?.intent.partNumber
                ? <b>MPN {instantPreview.intent.partNumber}</b>
                : <b className={instantSafety ? "route-red" : "route-amber"}>{instantSafety ? "Restricted-item review" : "Photo-first · no MPN needed"}</b>}
              {instantPreview?.intent.itemDescription && <b>Item {instantPreview.intent.itemDescription}</b>}
              <b>Price {instantPrice ? `$${instantPrice}` : "required"}</b>
              <b>Condition {instantCondition}</b>
              <b>Qty {instantQuantity}</b>
              <b>Channel eBay</b>
              <b>{instantShipping}</b>
              <b>{instantFitmentMode}</b>
              <b>{instantPreview?.noExternalRequestMade ? "No external request" : "Checking"}</b>
              <button onClick={() => navigate("new")}>Use fields instead <Icon name="arrow"/></button>
            </div>}
            <div className="command-examples"><span>Try:</span>{["List part 58487514 for $9.99", "List a used black dashboard for $49.99", "List a 1990 Corvette airbag for $49.99"].map((example) => <button key={example} onClick={() => { setInstantCommand(example); setInstantBuilt(false); setInstantPreview(null); }}>{example}</button>)}</div>
          </div>

          <div className="builder-rail" aria-label="Automatic listing build stages">
            {instantStages.map(([number,label,copy,complete]) => <div key={number} className={instantBuilt && complete ? "complete" : ""}><b>{number}</b><span><strong>{label}</strong><small>{copy}</small></span><Icon name={instantBuilt && complete ? "check" : "more"}/></div>)}
          </div>

          {!instantBuilt ? <div className="instant-empty"><span className="brand-scan"><b>PQ</b><i/><i/></span><h2>Your prefilled review will appear here.</h2><p>Run the command above to see the complete approval experience.</p></div> : <>
            <div className="draft-review-head"><div><span>Automatic draft review</span><h2>{instantItemLabel}</h2><p>Created by the PartQuill backend · seller price {instantPrice ? `$${instantPrice}` : "required"} · fingerprint {instantPreview?.fingerprint.slice(0, 10)}…</p></div><div><Badge tone={instantReady ? "green" : instantSafety ? "red" : "amber"}>{instantReady ? "Demo ready for private preflight" : instantSafety ? "Restricted-item hold" : instantPhotoFirst ? "Photos required · no part number needed" : instantHeld ? "Held — identity not verified" : instantDirty ? "Rebuild after price change" : "2 quick confirmations"}</Badge><button onClick={() => { setInstantBuilt(false); setInstantPreview(null); setInstantPhotos([]); window.scrollTo({top:0,behavior:"smooth"}); }}>Start over</button></div></div>

            <div className="instant-draft-grid">
              <div className="instant-draft-main">
                <div className="instant-product-card">
                  <div className="instant-media">
                    <div className={`catalog-image-candidate ${instantPhotoFirst ? "photo-first" : ""} ${instantSafety ? "safety" : ""}`}><span>{instantSafety ? "RESTRICTED ITEM · EVIDENCE INTAKE" : instantPhotoFirst ? "PHOTO-FIRST ITEM INTAKE" : "MEDIA REVIEW · PLACEHOLDER ONLY"}</span><Icon name={instantSafety ? "shield" : instantPhotoFirst ? "camera" : "box"}/><strong>{instantItemLabel}</strong><small>{instantPreview?.media.sourceDetail ?? "A seller-owned item photo is required."}</small></div>
                    <div className="instant-thumbs">{(instantPreview?.media.requiredViews ?? [ { id: "hero", label: "Hero", detail: "Whole item", required: true }, { id: "label", label: "Label", detail: "Readable markings", required: false } ]).slice(0, 4).map((view) => <button key={view.id} onClick={() => showNotice(`${view.label}: ${view.detail}`)}><Icon name={view.id.includes("label") || view.id.includes("oem") ? "search" : "camera"}/><span>{view.label}</span></button>)}</div>
                    {instantPhotos.length > 0 && <div className="staged-photo-grid" aria-label="Photos staged in this browser">{instantPhotos.map((photo) => <figure key={`${photo.name}-${photo.url.length}`}><img src={photo.url} alt="Seller-selected local preview"/><figcaption>{photo.name}</figcaption></figure>)}</div>}
                    <div className="media-source"><Icon name="alert"/><span><strong>{instantPreview?.media.sourceLabel ?? "Seller-owned item photo required"}</strong><small>No grey placeholder can enter the eBay payload.</small></span></div>
                    <label className="media-add-button"><Icon name="camera"/> {instantSafety ? "Add label + item photos" : instantPhotoFirst ? "Add item photos to continue" : "Add seller-owned item photo"}<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => stageInstantPhotos(event.target.files)}/></label>
                    <p className="local-photo-note"><Icon name="shield"/> Private pilot: selected images stay in this browser preview. Photo analysis and durable upload are not connected yet.</p>
                  </div>

                  <div className="instant-listing-copy">
                    <div className="listing-proof-strip">
                      <article><span>Identity source</span><strong><i className={instantSafety ? "red" : "amber"}/>{instantPreview?.identity.sourceLabel}</strong><small>{instantPreview?.identity.sourceDetail}</small></article>
                      <article><span>Fitment source</span><strong><i className="amber"/>{instantPreview?.fitment.sourceLabel}</strong><small>{instantPreview?.fitment.sourceDetail}</small></article>
                      <article><span>Seller facts</span><strong><i className={instantReady ? "green" : instantSafety ? "red" : "amber"}/>{instantReady ? "Complete" : instantSafety ? "Policy evidence missing" : instantPhotoFirst ? `${instantPreview?.media.minimumPhotos ?? 3} photos + condition` : "2 confirms left"}</strong><small>Physical item only</small></article>
                    </div>
                    <div className="copy-heading"><div><span>{instantSample ? "BUYER-FACING LISTING DEMO" : "WORKING DRAFT · NOT PUBLISHABLE"}</span><Badge tone="orange">TitleGuard · {instantTitle.length}/80</Badge></div><label><span>{instantSample ? "Illustrative catalog/title-guarded title" : instantSafety ? "Safety-held working title" : instantPhotoFirst ? "Seller-described working title" : "Catalog-held title"}</span><input value={instantTitle} readOnly/><small>{instantSample ? "This filled state demonstrates the approved UI. It is not live catalog evidence." : instantSafety ? "This title cannot enter a marketplace payload during the restricted-item hold." : instantPhotoFirst ? "PartQuill preserves what the seller said but does not treat it as verified identity or fitment." : "Brand, part type and category are intentionally absent until a unique authorized match exists."}</small></label></div>
                    {!instantCatalogRoute ? <div className={`instant-fitment-strip held ${instantSafety ? "safety" : ""}`}>
                      <div><span><i className={instantSafety ? "red" : "amber"}/><strong>{instantSafety ? "Compatibility blocked during safety review" : "Fitment is blank by design"}</strong></span><Badge tone={instantSafety ? "red" : "amber"}>No public claims</Badge></div>
                      <p>{instantPreview?.fitment.sourceDetail}</p>
                    </div> : instantFitmentMode === "Do not publish fitment" ? <div className="instant-fitment-strip held">
                      <div><span><i className="amber"/><strong>Fitment will not be published</strong></span><Badge tone="amber">Seller instruction</Badge></div>
                      <p>The command said “no fitment,” so compatibility rows are removed from the public payload.</p>
                    </div> : <div className="instant-fitment-strip held">
                      <div><span><i className="amber"/><strong>Fitment · {instantPreview?.fitment.totalApplications ?? 0} unverified applications</strong></span><Badge tone="amber">Not publishable</Badge></div>
                      <p>{instantPreview?.fitment.sourceDetail}</p>
                      {instantPreview?.fitment.applications.map((application) => <div className="fitment-sample-row" key={application.vehicle}><span><strong>{application.vehicle}</strong><small>{application.qualifier}</small></span><Badge tone="amber">Not verified</Badge></div>)}
                      <button onClick={() => openDraft("fitment")}>Inspect compatibility evidence <Icon name="arrow"/></button>
                    </div>}
                    <div className="instant-key-fields">
                      <label><span>Buy It Now price</span><div><b>$</b><input value={instantPrice} onChange={(event) => { setInstantPrice(event.target.value); setInstantDirty(true); setInstantPartConfirmed(false); setInstantConditionConfirmed(false); }}/></div><Badge tone={instantDirty ? "amber" : "green"}>{instantDirty ? "Rebuild required" : "Your command"}</Badge></label>
                      <label><span>Quantity</span><input value={instantQuantity} readOnly/><Badge tone={instantQuantity === "1" ? "slate" : "green"}>{instantQuantity === "1" ? "Seller default" : "Your command"}</Badge></label>
                      <label><span>Condition</span><input value={instantCondition} readOnly/><Badge tone="amber">{instantCondition === "Not specified" ? "Selection required" : "Confirm actual item"}</Badge></label>
                      <label><span>Custom SKU</span><input value={instantPreview?.listing.sku ?? "Pending identity"} readOnly/><Badge tone={instantHeld ? "amber" : "green"}>{instantHeld ? "Reservation only" : "Generated"}</Badge></label>
                    </div>
                    <div className="catalog-prefill"><div><span>{instantPreview?.identity.sourceLabel}</span><Badge tone={instantSample ? "amber" : instantSafety ? "red" : "orange"}>{instantSample ? "Illustrative fixture" : instantSafety ? "Safety hold" : instantPhotoFirst ? "Photo intake" : "Held"}</Badge></div><dl><div><dt>Brand</dt><dd>{instantPreview?.identity.brand ?? "Not verified"}</dd></div><div><dt>MPN / OE number</dt><dd>{instantPreview?.identity.manufacturerPartNumber ?? (instantPhotoFirst ? "Optional — add if found" : "Required for review")}</dd></div><div><dt>Product type</dt><dd>{instantPreview?.identity.productType ?? "Not verified"}</dd></div><div><dt>Supersessions</dt><dd>Included only when verified</dd></div><div><dt>eBay category</dt><dd>{instantPreview?.listing.category ?? (instantSafety ? "Blocked during policy review" : instantPhotoFirst ? "After photo identification" : "Held until identity resolves")}</dd></div><div><dt>Required aspects</dt><dd>{Object.keys(instantPreview?.listing.aspects ?? {}).length ? `${Object.keys(instantPreview?.listing.aspects ?? {}).length} currently supported` : "After category is verified"}</dd></div></dl></div>
                  </div>
                </div>

                {instantCatalogRoute ? <div className="instant-fitment-card">
                  <div className="fitment-prefill-title"><div><span className="traffic-light amber"/><span><strong>Full compatibility inspector</strong><small>Green requires a direct verified source. Amber stays held. Red is excluded.</small></span></div><Badge tone="amber">{instantPreview?.fitment.totalApplications ?? 0} unverified rows</Badge></div>
                  <div className="fitment-preview-table"><div><span>Scope</span><span>Rows</span><span>Source</span><span>Publish rule</span><span>State</span></div><div><strong>Vehicle compatibility</strong><span>{instantPreview?.fitment.totalApplications ?? 0}</span><span>{instantPreview?.fitment.sourceLabel}</span><span>{instantPreview?.fitment.state === "OMITTED_BY_SELLER" ? "Exclude every row" : "Hold until verified"}</span><Badge tone="amber">Not verified</Badge></div></div>
                  <div className="fitment-states"><span><i className="green"/>Green: proven fit</span><span><i className="amber"/>Amber: may fit / not verified</span><span><i className="red"/>Red: does not fit</span><button onClick={() => openDraft("fitment")}>Open compatibility inspector <Icon name="arrow"/></button></div>
                  <div className="vin-sandbox"><Icon name="shield"/><div><strong>{instantPreview?.recovery.label}</strong><p>Buyer-only recovery after a red mismatch. The seller listing is never silently changed.</p></div><input aria-label="Buyer VIN for correct-part recovery" placeholder="17-character VIN"/><button onClick={() => showNotice(instantPreview?.recovery.privacyNote ?? "A VIN lookup was not run.")}>Find correct part</button></div>
                </div> : <div className={`photo-evidence-card ${instantSafety ? "safety" : ""}`}>
                  <div className="photo-evidence-head"><div><Icon name={instantSafety ? "shield" : "camera"}/><span><strong>{instantSafety ? "Restricted-item evidence gate" : "No part number? Use the item itself."}</strong><small>{instantSafety ? "A typed vehicle name cannot clear an airbag listing." : "Three useful photos are enough to start; a part number remains optional."}</small></span></div><Badge tone={instantSafety ? "red" : "amber"}>{instantPhotos.length}/{instantPreview?.media.minimumPhotos ?? 3} photos staged</Badge></div>
                  <div className="photo-requirement-grid">{instantPreview?.media.requiredViews.map((requirement, index) => <article className={instantPhotos[index] ? "staged" : ""} key={requirement.id}><span>{instantPhotos[index] ? <Icon name="check"/> : String(index + 1).padStart(2, "0")}</span><div><strong>{requirement.label}</strong><small>{requirement.detail}</small></div><Badge tone={instantPhotos[index] ? "green" : instantSafety ? "red" : "amber"}>{instantPhotos[index] ? "Staged" : "Required"}</Badge></article>)}</div>
                  <div className="found-part-number"><div><span>{instantSafety ? "Readable OEM part number" : "Found a number while taking photos?"}</span><strong>{instantSafety ? "Required as evidence; it does not clear the policy hold." : "Optional — switch to catalog-assisted lookup."}</strong></div><input value={foundPartNumber} onChange={(event) => setFoundPartNumber(event.target.value)} placeholder="Enter label / casting number"/><button onClick={rebuildWithFoundPartNumber}>{instantSafety ? "Attach number" : "Rebuild with number"}<Icon name="arrow"/></button></div>
                  {instantSafety ? <div className="policy-gate"><div><Icon name="alert"/><span><strong>{instantPreview?.policy.label}</strong><small>PartQuill keeps Submit disabled until every current requirement is evidenced.</small></span></div><ul>{instantPreview?.policy.requirements.map((requirement) => <li key={requirement}><Icon name="shield"/>{requirement}</li>)}</ul>{instantPreview?.policy.sourceUrl && <a href={instantPreview.policy.sourceUrl} target="_blank" rel="noreferrer">Review the current eBay vehicle-parts policy <Icon name="arrow"/></a>}</div> : <div className="photo-route-truth"><Icon name="shield"/><p><strong>What happens next:</strong> photos may suggest identity, category and visible condition. They cannot prove hidden damage, vehicle fitment, origin, weight or dimensions. In this pilot, files remain a local preview and are not analyzed yet.</p></div>}
                </div>}

                <div className="instant-description-card"><div><span>{instantSafety ? "Safety-held draft notes" : "Generated description"}</span><Badge tone={instantSafety ? "red" : instantHeld ? "amber" : "green"}>Unsupported claims omitted</Badge></div><h3>{instantPreview?.identity.productType ?? instantPreview?.intent.itemDescription ?? "Unidentified automotive item"}{instantPreview?.intent.partNumber ? ` — Part ${instantPreview.intent.partNumber}` : ""}</h3><p>{instantPreview?.listing.description}</p><ul><li>Actual seller item and contents require seller evidence.</li><li>Aliases and supersessions appear only when independently verified.</li><li>Unsupported fitment, origin and image rights stay out of the payload.</li></ul><div><Icon name="shield"/><span>Identity · Fitment · Condition · Photo source · Shipping promise</span></div></div>
              </div>

              <aside className="instant-submit-panel">
                <div className={`instant-score ${instantSafety ? "safety" : instantPhotoFirst ? "photo-first" : ""}`}><div><span>Listing status</span><Badge tone={instantReady ? "green" : instantSafety ? "red" : "amber"}>{instantReady ? "Demo facts complete" : instantSafety ? "Restricted-item hold" : instantPhotoFirst ? "Photo intake" : "Action required"}</Badge></div><strong>{instantReady ? "Ready for simulated preflight" : instantStatusHeading}</strong><p>{instantReady ? "Next: private preflight binds the exact demo payload before final approval." : instantStatusCopy}</p></div>
                <div className="autofill-summary"><span>Automatically prefilled</span>{[ ["Price", instantPrice ? `$${instantPrice}` : "Required", instantPrice ? "green" : "amber"], ["Quantity", instantQuantity, "green"], ["Condition", instantCondition, instantCondition === "Not specified" ? "amber" : "green"], ["Listing format", instantPreview?.listing.format ?? "Buy It Now · GTC", "green"], ["Shipping", instantShipping, instantSafety ? "amber" : "green"], ["Handling", instantPreview?.listing.handlingTime ?? "1 business day", "green"], ["Returns", instantPreview?.listing.returns ?? "30 days · buyer-paid", "green"], ["Media", instantPhotos.length ? `${instantPhotos.length} staged locally` : `${instantPreview?.media.minimumPhotos ?? 1} required`, "amber"], ["International", instantSafety ? "Disabled for airbag route" : "Held until origin", "amber"] ].map(([label,value,tone]) => <div key={label}><Icon name={tone === "green" ? "check" : "alert"}/><span><strong>{label}</strong><small>{value}</small></span></div>)}</div>
                <div className="smallest-confirmations"><span>{instantSafety ? "Seller confirmations do not replace policy evidence" : instantPhotoFirst ? "Confirm the physical item after adding photos" : "Only confirm what the catalog cannot know"}</span><label className={instantPartConfirmed ? "confirmed" : ""}><input type="checkbox" checked={instantPartConfirmed} onChange={(event) => setInstantPartConfirmed(event.target.checked)}/><span><strong>{instantPreview?.confirmations[0]?.label ?? "This is the exact part I have in hand"}</strong><small>{instantPreview?.confirmations[0]?.detail}</small></span></label><label className={instantConditionConfirmed ? "confirmed" : ""}><input type="checkbox" disabled={instantCondition === "Not specified"} checked={instantConditionConfirmed} onChange={(event) => setInstantConditionConfirmed(event.target.checked)}/><span><strong>{instantPreview?.confirmations[1]?.label ?? `Condition = ${instantCondition}`}</strong><small>{instantPreview?.confirmations[1]?.detail} Open the full editor to change it.</small></span></label></div>
                <div className={`instant-submit-state ${instantReady ? "ready" : "held"}`}><Icon name={instantReady ? "check" : "alert"}/><span><strong>{instantReady ? "Demo ready for private preflight" : instantSafety ? "Submit disabled — restricted-item review incomplete" : instantPhotoFirst ? "Submit disabled — photos and identification incomplete" : instantHeld ? "Held — unique catalog identity required" : instantDirty ? "Payload changed — rebuild the command" : "Held — two seller facts remain"}</strong><small>{instantReady ? "Gate 1 validates this exact fingerprint; Gate 2 is separate. Actual eBay writes remain disabled." : "Nothing has been sent to eBay."}</small></span></div>
                <button className="primary full" disabled={!instantReady} onClick={() => navigate("review")}>Review simulated private preflight <Icon name="arrow"/></button>
                <button className="text-button center" onClick={() => instantPhotoFirst || instantSafety ? showNotice("The photo-first editor is being connected progressively; no unsupported listing was created.") : openDraft("listing")}>{instantPhotoFirst || instantSafety ? "Continue after evidence review" : "Open the full editor"}</button>
                <p className="prototype-note"><Icon name="shield"/> Backend connected. Catalog and eBay writes remain fail-closed; the final handoff opens ebay.com without transmitting this payload.</p>
              </aside>
            </div>

            <div className="instant-primary-path"><div className="active"><b>1</b><span><strong>One command</strong><small>Part or description + price</small></span></div><Icon name="arrow"/><div className="active"><b>2</b><span><strong>{instantPhotoFirst || instantSafety ? "Evidence intake" : "Automatic draft"}</strong><small>{instantPhotoFirst || instantSafety ? "Actual item photos + facts" : "Catalogue + seller defaults"}</small></span></div><Icon name="arrow"/><div><b>3</b><span><strong>Private preflight</strong><small>Validate + show charges</small></span></div><Icon name="arrow"/><div><b>4</b><span><strong>Submit to eBay</strong><small>Separate exact-payload approval</small></span></div></div>
          </>}
        </section>}

        {view === "inventory" && <section className="view view-inventory">
          <SectionHeading eyebrow="Exception-first seller cockpit" title="Inventory" body="Blocked and held parts open first. Ready inventory stays one click away." action={<div className="heading-actions"><button className="secondary" onClick={() => showNotice("CSV import is represented in this prototype; no file was uploaded.")}><Icon name="inventory" /> Import CSV</button><button className="primary" onClick={() => navigate("new")}><Icon name="plus" /> Create listing</button></div>} />
          <div className="metric-grid"><article><span>Total parts</span><strong>24</strong><small>Across all stages</small></article><article><span>Drafts</span><strong>8</strong><small>3 need action</small></article><article><span>Ready</span><strong>5</strong><small>Awaiting approval</small></article><article><span>Est. seller value</span><strong>$12.4k</strong><small>Seller-entered prices</small></article></div>
          <div className="priority-strip"><div><Badge tone="red">1 blocked</Badge><strong>Restricted item excluded</strong><span>It cannot enter a preflight or publish set.</span></div><div><Badge tone="amber">2 held</Badge><strong>Smallest next questions ready</strong><span>Confirm side or remove fitment.</span></div><button onClick={() => navigate("risk")}>Open exceptions <Icon name="arrow" /></button></div>
          <div className="inventory-tools"><div className="filter-tabs">{["All", "Needs action", "Draft", "Ready", "Published"].map((filter) => <button key={filter} className={inventoryFilter === filter ? "active" : ""} onClick={() => setInventoryFilter(filter)}>{filter}</button>)}</div><label className="search-box"><Icon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search part, SKU or description" /></label></div>
          <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Part / description</th><th>SKU</th><th>Condition</th><th>Qty</th><th>Seller price</th><th>Status</th><th>Updated</th><th>Next action</th></tr></thead><tbody>{filteredRows.map((row) => <tr key={row.sku} onClick={() => row.status !== "Blocked" ? openDraft(row.part === "13568-29025" ? "listing" : "identity") : navigate("risk")}><td><strong>{row.part}</strong><span>{row.description}</span></td><td>{row.sku}</td><td>{row.condition}</td><td>{row.qty}</td><td>{row.price}</td><td><Badge tone={row.tone}>{row.status}</Badge></td><td>{row.updated}</td><td><button>{row.next}<Icon name="arrow" /></button></td></tr>)}</tbody></table>{filteredRows.length === 0 && <div className="empty-state">No inventory matches this filter.</div>}</div>
          <div className="inventory-footer"><span><Icon name="shield" /> One inventory authority: PartQuill master</span><span>Demo inventory only</span><span>eBay writes remain disabled</span></div>
        </section>}

        {view === "new" && <section className="view">
          <SectionHeading eyebrow="Stage 0 · Intent" title="Start one seller listing" body="Choose the strongest evidence you already have. You will approve twice before anything can become public." />
          <div className="stage-rail">{["Intent", "Capture", "Resolve", "Build", "Protect", "Preflight", "Approve", "Operate"].map((stage, index) => <div key={stage} className={index === 0 ? "active" : ""}><span>{index}</span><strong>{stage}</strong></div>)}</div>
          <div className="intent-layout">
            <div className="intent-main"><span className="field-label">How are you starting?</span><div className="intent-options">{([ ["part", "Part number", "MPN, OE or casting"], ["barcode", "Barcode / package", "GTIN or UPC first"], ["csv", "CSV row", "One row or large batch"], ["held", "Held draft", "Continue exactly where you stopped"] ] as const).map(([id, label, copy]) => <button key={id} className={captureMode === id ? "selected" : ""} onClick={() => setCaptureMode(id)}><Icon name={id === "part" ? "search" : id === "barcode" ? "camera" : id === "csv" ? "inventory" : "edit"}/><span><strong>{label}</strong><small>{copy}</small></span><i /></button>)}</div>
              <div className="start-card"><label><span>{captureMode === "part" ? "Manufacturer part number" : captureMode === "barcode" ? "Scan or enter GTIN" : captureMode === "csv" ? "Choose CSV source" : "Draft SKU"}</span><div><input defaultValue={captureMode === "part" ? "13568-29025" : captureMode === "held" ? "VLT-1042" : ""} placeholder={captureMode === "barcode" ? "Scan barcode" : "Enter value"}/><button onClick={() => showNotice("Sample identifier accepted. No external catalog was contacted.")}><Icon name="search" /> Resolve</button></div></label><div className="capture-shortcuts"><button onClick={() => showNotice("Camera capture is represented by the evidence checklist below.")}><Icon name="camera" /> Use camera</button><button onClick={() => showNotice("Tear-down session started as a local prototype only.")}><Icon name="box" /> Tear-down session</button></div></div>
            </div>
            <aside className="capture-checklist"><div className="panel-title"><Icon name="camera"/><div><strong>Evidence capture plan</strong><span>Guided angles—not a photo dump</span></div></div><ul><li className="done"><b>01</b><span><strong>Whole item</strong><small>Complete item and quantity</small></span><i>Ready</i></li><li><b>02</b><span><strong>Label / MPN face</strong><small>Readable identity evidence</small></span><i>Required</i></li><li><b>03</b><span><strong>Reverse / connectors</strong><small>Mounting and condition</small></span><i>Required</i></li><li><b>04</b><span><strong>Defects / wear</strong><small>Used items or damaged packaging</small></span><i>As needed</i></li><li><b>05</b><span><strong>Packaged dimensions</strong><small>Separate from product size</small></span><i>Shipping</i></li></ul><div className="truth-note"><Icon name="shield"/><p>A photo may propose identity. It cannot prove fitment, internal condition, dimensions, weight or origin.</p></div><button className="primary full" onClick={() => openDraft("identity")}>Load sample seller draft <Icon name="arrow" /></button></aside>
          </div>
        </section>}

        {view === "research" && <section className="view">
          <SectionHeading eyebrow="Seller research · Read only" title="Resolve the part before writing the listing" body="Exact identity may be reusable. Fitment, condition, quantity and price remain separate seller decisions." action={<button className="secondary" onClick={() => showNotice("The research result was refreshed locally for this prototype.")}><Icon name="live"/> Refresh</button>} />
          <div className="research-search"><label><span>OEM part number</span><div><input defaultValue="13568-29025"/><button><Icon name="search"/> Research part</button></div></label><label><span>Buyer VIN sandbox · optional</span><div><input placeholder="17-character VIN"/><button onClick={() => showNotice("No VIN was transmitted. This is a UI-only compatibility sandbox.")}>Check draft</button></div></label></div>
          <div className="research-result"><div className="research-identity"><div className="part-glyph"><Icon name="box"/></div><div><Badge tone="green">Exact part number</Badge><h2>13568-29025 — Belt, Timing</h2><p>Superseded by <strong>13568-YZZ10</strong> · Diagram callout 13568</p></div><button className="primary" onClick={() => openDraft("identity")}>Attach identity to draft</button></div><div className="fitment-verdict amber"><span>!</span><div><strong>Fitment not verified for a specific vehicle</strong><p>Potential catalog applications exist, but this seller draft will not publish compatibility without permitted evidence.</p></div><button onClick={() => openDraft("fitment")}>Inspect applications</button></div><div className="traffic-guide"><div className="green"><b>GREEN</b><span>eBay-returned compatibility for a direct product match</span></div><div className="amber"><b>AMBER</b><span>Seller-confirmed, broad or incomplete evidence</span></div><div className="red"><b>NONE</b><span>No public fitment claim; buyer verification boilerplate used</span></div></div><div className="research-facts"><article><span>Anonymous reference range</span><strong>$49.97–$54.59</strong><small>Not an eBay market value or listing recommendation</small></article><article><span>Seller listing price</span><strong>$79.95</strong><small>Seller-entered; separate from research</small></article><article><span>Source checks</span><strong>2 of 3 exact</strong><small>One reference path unavailable</small></article><article><span>Listing condition</span><strong>Not inherited</strong><small>Seller must confirm the actual item</small></article></div></div>
        </section>}

        {view === "drafts" && <section className="view editor-view">
          <div className="editor-head"><div><span className="crumb">Draft listings / VLT-1042</span><h1>13568-29025 · Toyota timing belt</h1><p>Last saved just now · Draft v12 · Nothing transmitted</p></div><div><button className="secondary" onClick={() => showNotice("Draft saved locally in this prototype.")}>Save draft</button><button className="primary" onClick={() => navigate("review")}>Review private preflight <Icon name="arrow"/></button></div></div>
          <div className="evidence-summary"><EvidenceMeters /></div>
          <div className="editor-tabs" role="tablist">{([ ["listing", "Listing"], ["identity", "Identity"], ["condition", "Condition"], ["fitment", "Fitment"], ["images", "Images"], ["shipping", "Shipping"], ["pricing", "Pricing"], ["policies", "Policies"], ["preview", "Buyer preview"] ] as Array<[EditorTab, string]>).map(([id, label]) => <button key={id} role="tab" aria-selected={editorTab === id} className={editorTab === id ? "active" : ""} onClick={() => setEditorTab(id)}>{label}{id === "fitment" && <i>1</i>}</button>)}</div>
          <div className="editor-layout"><div className="editor-content">
            {editorTab === "listing" && <div className="form-section"><SectionHeading eyebrow="Stage 3 · Listing card" title="What the buyer will see" body="Identity-driven fields first. Every compatibility phrase must have a permitted source."/><label className="form-field"><span>Title <small>{title.length}/80</small></span><input value={title} maxLength={80} onChange={(event) => { setTitle(event.target.value); setPublicApproved(false); }}/><i className="title-meter"><b style={{ width: `${Math.min(100, title.length / 80 * 100)}%` }}/></i><small>TitleGuard removes emoji, duplicate tokens and unsupported vehicle claims.</small></label><div className="form-grid"><label className="form-field"><span>eBay leaf category</span><button className="select-button">Timing Components / Timing Belts <Icon name="arrow"/></button><small>Current taxonomy must be rechecked during preflight.</small></label><label className="form-field"><span>Condition</span><button className="select-button">New <Badge tone="green">Seller confirmed</Badge></button><small>Catalog condition did not set this value.</small></label><label className="form-field"><span>Quantity</span><input value={quantity} onChange={(event) => setQuantity(event.target.value)}/></label><label className="form-field"><span>Custom SKU</span><input defaultValue="VLT-1042"/><small>Collision guard found no active offer.</small></label></div><div className="description-card"><div><span>Buyer-visible description</span><Badge tone="green">Contract block on</Badge></div><h3>Genuine Toyota Timing Belt — Part 13568-29025</h3><p>New old stock timing belt. Please verify the part number against your original part before purchase. Compatibility is not claimed in this listing.</p><h4>Condition notes</h4><ul><li>Actual seller-owned item shown in the listing photographs.</li><li>Packaging has shelf wear; belt is unused.</li><li>Timing belt only; no tensioner, idler or water pump included unless pictured.</li></ul>{sellerContract && <div className="buyer-contract"><strong>PartQuill evidence statement</strong><span>Identity: Brand + MPN seller-confirmed · Fitment: Not claimed · Photos: Originals retained · Condition: Seller-confirmed</span></div>}</div></div>}

            {editorTab === "identity" && <div className="form-section"><SectionHeading eyebrow="Stage 2 · Resolve" title="Identity and item specifics" body="The seller sees only unresolved facts first; the full aspect set stays available below."/><div className="smallest-question"><Icon name="search"/><div><span>Smallest next question</span><strong>Does the physical label on your item read 13568-29025?</strong><p>This confirms the actual seller item—not merely a catalog page.</p></div><div><button onClick={() => showNotice("Identity marked for seller recheck.")}>No / unsure</button><button className="confirm" onClick={() => showNotice("Identity confirmation recorded in the draft audit trail.")}>Yes, confirmed</button></div></div><div className="specifics-table">{itemSpecifics.map((item) => <div key={item.field}><span>{item.field}</span><strong>{item.value}</strong><Badge tone={item.tone}>{item.source}</Badge><button aria-label={`Edit ${item.field}`}><Icon name="edit"/></button></div>)}</div><button className="text-button" onClick={() => showNotice("All category aspects are already visible in this prototype.")}>Show all current category aspects</button></div>}

            {editorTab === "condition" && <div className="form-section"><SectionHeading eyebrow="Condition honesty assistant" title="Say what the photos can prove" body="Condition ID and buyer-visible notes are built from seller confirmations—not appearance alone."/><div className="condition-layout"><div className="condition-checks">{[ ["Unused / never installed", true], ["Original packaging present", true], ["Packaging shelf wear", true], ["Cracks or cuts", false], ["Contamination or fluid exposure", false], ["Missing hardware", false], ["Function tested", false] ].map(([label, checked]) => <label key={String(label)}><input type="checkbox" defaultChecked={Boolean(checked)}/><span>{label}</span></label>)}</div><aside><Badge tone="green">Condition ID mapped</Badge><strong>New</strong><p>“New old stock” remains in the description because the packaging shows shelf wear.</p><div><span>Buyer-visible note</span><b>Unused item. Packaging has storage wear. Please review all seller photos.</b></div></aside></div></div>}

            {editorTab === "fitment" && <div className="form-section"><SectionHeading eyebrow="Compatibility inspector" title="Potential does not mean publishable" body="Rows are grouped for research. Source and engine qualifiers stay visible before any public claim." action={<button className="danger-outline" onClick={() => { setFitmentIncluded(false); showNotice("All compatibility claims removed; safe buyer-verification text remains."); }}>Publish without fitment</button>} /><div className={`fitment-state ${fitmentIncluded ? "included" : "excluded"}`}><div><span>{fitmentIncluded ? "AMBER" : "NO PUBLIC FITMENT"}</span><strong>{fitmentIncluded ? "Seller-confirmed rows require review" : "Compatibility rows are excluded from the listing"}</strong><p>{fitmentIncluded ? "This remains amber and may increase return risk." : "Buyer-verification boilerplate will be forced into the description."}</p></div><button onClick={() => setFitmentIncluded(!fitmentIncluded)}>{fitmentIncluded ? "Remove all rows" : "Review adding rows"}</button></div><div className="compatibility-table"><div className="table-head"><span>Application</span><span>Source</span><span>Status</span><span /></div>{compatibilityRows.map((row) => <div key={row.application}><strong>{row.application}</strong><span>{row.source}</span><Badge tone={row.tone}>{row.status}</Badge><button onClick={() => showNotice("This potential application remains excluded without stronger evidence.")}>Inspect</button></div>)}</div><div className="vin-sandbox"><Icon name="shield"/><div><strong>Compatibility sandbox</strong><p>Paste a buyer-style VIN to test this draft’s claims before publishing. The full VIN is not retained by PartQuill; production must disclose any temporary external decoder/catalog transmission.</p></div><input placeholder="17-character VIN"/><button onClick={() => showNotice("VIN check was not run; this is a UI-only prototype.")}>Test draft</button></div></div>}

            {editorTab === "images" && <div className="form-section"><SectionHeading eyebrow="Image Studio · Evidence roles" title="Every photo has a job" body="Approved derivatives improve presentation. Originals remain immutable evidence and are never replaced." action={<button className="secondary" onClick={() => showNotice("Image Studio handoff prepared; no image was sent.")}><Icon name="camera"/> Add photos</button>} /><div className="image-role-grid">{imageRoles.map((image, index) => <article key={image.role}><div className="image-number"><span>{String(index + 1).padStart(2,"0")}</span><Icon name={image.role === "Package" ? "box" : "camera"}/></div><Badge tone={image.tone}>{image.state}</Badge><strong>{image.role} · {image.label}</strong><small>{image.note}</small><button onClick={() => showNotice(`${image.role} role guidance opened.`)}>Role guidance</button></article>)}</div><div className="image-integrity"><div><Icon name="shield"/><span><strong>Foreground integrity</strong><small>Geometry, labels, damage, wear, quantity and camera angle preserved.</small></span></div><Badge tone="green">QA passed</Badge><div><Icon name="receipt"/><span><strong>Rights basis</strong><small>Seller-owned originals; no third-party watermark removal requested.</small></span></div><Badge tone="green">Confirmed</Badge></div></div>}

            {editorTab === "shipping" && <div className="form-section"><SectionHeading eyebrow="Shipping decision trio" title="Three independent promises" body="Origin can hold international without unnecessarily blocking a permitted domestic listing."/><div className="shipping-trio">{[{id:"pickup",label:"Local pickup",body:"Buyer collects from seller location",value:pickup,set:setPickup},{id:"domestic",label:"Domestic parcel",body:"Calculated from packaged measurements",value:domestic,set:setDomestic},{id:"international",label:"International",body:"Requires origin, HS and program eligibility",value:international,set:setInternational}].map((option) => <article key={option.id} className={option.value ? "selected" : ""}><div><Icon name={option.id === "pickup" ? "box" : "truck"}/><label className="switch"><input type="checkbox" checked={option.value} onChange={(event) => option.set(event.target.checked)}/><span /></label></div><strong>{option.label}</strong><p>{option.body}</p>{option.id === "international" && !option.value && <Badge tone="amber">Off · origin unknown</Badge>}</article>)}</div><div className="dimension-grid"><article><span>Product measurements</span><div><label>Length<input defaultValue="10.5"/></label><label>Width<input defaultValue="8.0"/></label><label>Height<input defaultValue="1.8"/></label></div><small>Reference only; never copied into shipping fields.</small></article><article><span>Packaged measurements <Badge tone="green">Measured</Badge></span><div><label>Length<input defaultValue="13"/></label><label>Width<input defaultValue="10"/></label><label>Height<input defaultValue="3"/></label><label>Weight<input defaultValue="2 lb 4 oz"/></label></div><small>Seller-entered scale and tape measurements.</small></article></div></div>}

            {editorTab === "pricing" && <div className="form-section"><SectionHeading eyebrow="Seller-controlled economics" title="Price from your rules—not marketplace scraping" body="eBay listing-charge responses are disclosed during review and never silently fed back into the price formula."/><div className="pricing-layout"><div className="price-entry"><label><span>Buy It Now price</span><div><b>$</b><input value={price} onChange={(event) => { setPrice(event.target.value); setPublicApproved(false); }}/></div></label><label><span>Seller acquisition cost</span><div><b>$</b><input defaultValue="38.00"/></div></label><label><span>Minimum profit</span><div><b>$</b><input defaultValue="20.00"/></div></label><label><span>Shipping charged</span><div><b>$</b><input defaultValue="0.00"/></div></label></div><aside><span>Modeled seller outcome</span><strong>$21.64 profit</strong><i><b style={{width:"63%"}}/></i><dl><div><dt>Item price</dt><dd>${price}</dd></div><div><dt>Seller cost</dt><dd>− $38.00</dd></div><div><dt>Shipping assumption</dt><dd>− $8.20</dd></div><div><dt>Fee assumption</dt><dd>− $12.11</dd></div></dl><small>Illustrative seller assumptions only. Actual eBay transaction charges may differ.</small></aside></div><div className="price-boundary"><Icon name="shield"/><p><strong>Pricing boundary:</strong> no “one cent below,” no eBay-content model, no automatic repricing. The seller owns this number.</p></div></div>}

            {editorTab === "policies" && <div className="form-section"><SectionHeading eyebrow="Seller account defaults" title="Reuse policies, never reuse unsupported claims" body="Successful category settings can be copied. Fitment, condition and actual-item evidence cannot."/><div className="policy-grid">{[ ["Payment / offer policy", "Buy It Now · Best Offer off"], ["Domestic shipping", "Ground Advantage · 1 business day"], ["Return policy", "30-day buyer-paid returns"], ["Merchant location", "Confirm before live use"], ["Description footer", "Warranty + buyer verification"], ["Inventory authority", "PartQuill master"] ].map(([label,value]) => <article key={label}><span>{label}</span><strong>{value}</strong><button onClick={() => showNotice(`${label} picker opened.`)}>Change</button></article>)}</div><button className="match-listing" onClick={() => showNotice("Shipping, return and location copied from a successful same-category seller listing. Fitment was not copied.")}><Icon name="link"/><span><strong>Match my other successful listing</strong><small>Copy shipping, returns and location only</small></span><Icon name="arrow"/></button></div>}

            {editorTab === "preview" && <div className="form-section"><SectionHeading eyebrow="Buyer preview" title="Read it like the person receiving the box" body="The evidence strip makes the listing’s strongest promises—and its deliberate omissions—easy to understand."/><article className="buyer-preview"><div className="buyer-image"><Icon name="box"/><span>Approved hero derivative</span><small>Original retained in EvidencePack</small></div><div className="buyer-copy"><h2>{title}</h2><div className="buyer-price"><strong>${price}</strong><span>Quantity {quantity}</span></div><Badge tone="green">New · seller confirmed</Badge><p>Actual seller-owned item shown. Packaging has shelf wear. Timing belt only; no additional components included unless pictured.</p><div className="buyer-evidence"><span><b>Identity</b>Brand + MPN confirmed</span><span><b>Fitment</b>{fitmentIncluded ? "Seller-confirmed · review" : "Not claimed"}</span><span><b>Photos</b>Originals retained</span><span><b>Shipping</b>{domestic ? "Domestic ready" : "Pickup only"}</span></div><div className="fitment-boilerplate">Please verify part number 13568-29025 against your original part before purchase. Vehicle compatibility is not guaranteed by this listing.</div></div></article></div>}
          </div><aside className="readiness-panel"><div className="readiness-score"><span>Draft status</span><strong>2<small> confirms left</small></strong><p>Evidence states—not a fuzzy percentage—control whether the draft advances.</p></div><div className="gate-list"><span>Why can’t this publish yet?</span><div className="done"><Icon name="check"/><p><strong>Identity confirmed</strong><small>Label + seller confirmation</small></p></div><div className="done"><Icon name="check"/><p><strong>Seller facts complete</strong><small>Condition, quantity, contents</small></p></div><div className="done"><Icon name="check"/><p><strong>Compatibility safe</strong><small>No unsupported rows included</small></p></div><div className="hold"><Icon name="alert"/><p><strong>International held</strong><small>Origin remains unknown; domestic unaffected</small></p></div><div><Icon name="shield"/><p><strong>Private preflight required</strong><small>Payload and available fee estimate</small></p></div><div><Icon name="shield"/><p><strong>Public approval required</strong><small>Separate exact-payload consent</small></p></div></div><div className="return-risk"><div><span>Returns-risk preview</span><Badge tone="green">Low–moderate</Badge></div><p>Part number, package and contents are clear. Fitment is omitted, reducing does-not-fit exposure.</p></div><button className="primary full" onClick={() => navigate("review")}>Run private preflight <Icon name="arrow"/></button><p className="safe-note">This button opens review only. Nothing is sent to eBay.</p></aside></div>
          <div className="sticky-economics"><div><span>Category</span><strong>Timing Belts</strong></div><div><span>Seller price</span><strong>${price}</strong></div><div><span>Domestic</span><strong>{domestic ? "Ready" : "Off"}</strong></div><div><span>International</span><strong>{international ? "Review" : "Held"}</strong></div><div><span>Returns</span><strong>30 days</strong></div><button onClick={() => navigate("review")}>Review gates <Icon name="arrow"/></button></div>
        </section>}

        {view === "review" && <section className="view">
          <SectionHeading eyebrow="Stage 5 · Private preflight" title="Approve the private payload first" body="This prepares an unpublished offer and requests the latest available listing-charge estimate. It does not create a public listing." action={<Badge tone="amber">Not public</Badge>} />
          <div className="preflight-grid"><div><div className="payload-card"><div className="payload-head"><div><span>Draft payload</span><strong>{instantPreview?.listing.sku ?? "PQ-HELD"}</strong></div><Badge tone="green">Fingerprint locked</Badge></div><code>sha256: {instantPreview?.fingerprint ?? "preview unavailable"}</code><dl><div><dt>Seller</dt><dd>Private pilot seller</dd></div><div><dt>SKU</dt><dd>{instantPreview?.listing.sku ?? "Held"}</dd></div><div><dt>Offer state</dt><dd>Unpublished simulation only</dd></div><div><dt>Fitment rows</dt><dd>0 public rows</dd></div><div><dt>Image set</dt><dd>Seller photo still required</dd></div><div><dt>Inventory authority</dt><dd>PartQuill master</dd></div></dl></div><div className="diff-card"><div><span>Review summary</span><Badge tone="orange">Illustrative payload</Badge></div>{publishDiff.map((row) => <article key={row.field}><strong>{row.field}</strong><span>{row.before}</span><Icon name="arrow"/><b>{row.after}</b><small>{row.state}</small></article>)}</div></div><aside className="fee-card"><div className="fee-head"><Icon name="money"/><div><span>eBay preflight estimate</span><strong>{feeFresh ? "$0.00 illustrative estimate" : "Not requested"}</strong></div><Badge tone={feeFresh ? "green" : "slate"}>{feeFresh ? "Fresh · simulation" : "Pending"}</Badge></div><p>No eBay request occurs in this release. Final-value, payment, tax-dependent, advertising and transaction charges are not estimated.</p><dl><div><dt>Insertion estimate</dt><dd>{feeFresh ? "$0.00 sample" : "—"}</dd></div><div><dt>Subtitle</dt><dd>Off</dd></div><div><dt>Promoted listing</dt><dd>Off</dd></div><div><dt>Best Offer</dt><dd>Off</dd></div></dl><div className="api-ack"><Icon name="shield"/><p><strong>Inventory API ownership</strong><span>When eBay staging is enabled later, listings created here must be revised, reconciled and withdrawn through the same controlled workflow.</span></p></div><label className={feeFresh ? "approval-check" : "approval-check disabled"}><input type="checkbox" disabled={!feeFresh} checked={preflightApproved} onChange={(event) => setPreflightApproved(event.target.checked)}/><span><strong>I approve this exact payload for private simulation only.</strong><small>Nothing becomes public from this approval.</small></span></label>{!feeFresh ? <button className="primary full" onClick={() => { setFeeFresh(true); setPreflightApproved(false); showNotice("Illustrative fee state returned. No eBay request was made."); }}>Run simulated preflight</button> : <button className="primary full" disabled={!preflightApproved} onClick={() => navigate("ready")}>Lock private simulation <Icon name="arrow"/></button>}<button className="text-button center" onClick={() => navigate("instant")}>Return to command</button></aside></div>
        </section>}

        {view === "ready" && <section className="view">
          <SectionHeading eyebrow="Stage 6 · Separate public approval" title="Ready to send—after one final exact-payload check" body="Any material edit resets this approval and returns the item to private preflight." action={<Badge tone={preflightApproved ? "green" : "amber"}>{preflightApproved ? "Preflight locked" : "Preflight required"}</Badge>} />
          <div className="ready-layout"><div className="ready-listing"><div className="ready-image"><Icon name="camera"/><span>Seller photo required</span></div><div><Badge tone="amber">Illustrative identity · no fitment claim</Badge><h2>{title}</h2><p>SKU {instantPreview?.listing.sku ?? "Held"} · Qty {quantity} · {instantCondition}</p><strong>${price}</strong><div className="ready-facts"><span><b>Fitment</b>Not claimed</span><span><b>Domestic</b>{domestic ? "Default ready" : "Off"}</span><span><b>International</b>{international ? "Review" : "Held"}</span><span><b>Returns</b>30 days</span></div></div></div><aside className="public-approval"><div className="approval-seal"><Icon name="shield"/><span><strong>Exact fingerprint unchanged</strong><small>{instantPreview?.fingerprint.slice(0, 16)}… · simulation current</small></span></div><label className={!preflightApproved ? "approval-check disabled" : "approval-check"}><input type="checkbox" disabled={!preflightApproved} checked={publicApproved} onChange={(event) => setPublicApproved(event.target.checked)}/><span><strong>I approve this exact demo handoff.</strong><small>Changing title, price, quantity, images, aspects or fitment requires approval again.</small></span></label><div className="send-boundary"><strong>Safe handoff only</strong><p>The button below opens eBay’s public home page. It does not sign in, access a seller account, transmit this draft or create a listing.</p></div><a className={`ebay-send ${publicApproved ? "enabled" : "disabled"}`} href={publicApproved ? (bootstrap?.ebay.handoffUrl ?? "https://www.ebay.com/") : undefined} target="_blank" rel="noreferrer" aria-disabled={!publicApproved} onClick={(event) => { if (!publicApproved) event.preventDefault(); }}>Send to eBay <Icon name="arrow"/></a><p className="safe-note">Destination: ebay.com main page only · no listing payload attached</p></aside></div>
          <div className="ready-queue"><div><span>Ready queue</span><strong>5 items</strong></div><p>Approve one at a time or select a ready set. Every item keeps its own hash, fee response and public approval.</p><button onClick={() => showNotice("Quiet-hours scheduling remains a prototype setting.")}>Schedule for 6:00 AM</button><button onClick={() => showNotice("EvidencePack prepared for VLT-1042.")}>Download EvidencePack</button></div>
        </section>}

        {view === "published" && <section className="view">
          <SectionHeading eyebrow="Stage 7 · Operate" title="Published listing control" body="PartQuill owns the full Inventory API lifecycle: retrieve, revise, reconcile and withdraw." action={<button className="secondary" onClick={() => showNotice("Reconciliation simulated; no external account was contacted.")}><Icon name="live"/> Reconcile now</button>} />
          <div className="published-metrics"><article><span>Active listings</span><strong>11</strong><small>10 healthy</small></article><article><span>Available quantity</span><strong>37</strong><small>One stock authority</small></article><article><span>Open drift</span><strong>1</strong><small>Action required</small></article><article><span>Does-not-fit</span><strong>0</strong><small>Last 30 days</small></article></div><div className="watch-strip"><Icon name="shield"/><div><strong>Post-publish watch is active</strong><p>Category, aspects, compatibility, authorization, recall evidence, price and quantity are checked for controlled revision tasks.</p></div><Badge tone="green">Monitoring design</Badge></div><div className="data-table-wrap"><table className="data-table published-table"><thead><tr><th>Listing / SKU</th><th>Price</th><th>Qty</th><th>Views</th><th>Health</th><th>Last reconciled</th><th>Actions</th></tr></thead><tbody>{publishedRows.map((row) => <tr key={row.sku}><td><strong>{row.listing}</strong><span>{row.sku}</span></td><td>{row.price}</td><td>{row.qty}</td><td>{row.views}</td><td><Badge tone={row.status === "Healthy" ? "green" : "orange"}>{row.status}</Badge></td><td>{row.reconciled}</td><td><div className="row-actions"><button onClick={() => showNotice(`Revision draft opened for ${row.sku}.`)}>Revise</button><button onClick={() => showNotice(`Withdrawal confirmation opened for ${row.sku}.`)}>Withdraw</button></div></td></tr>)}</tbody></table></div><div className="drift-panel"><Badge tone="orange">Remote drift</Badge><div><strong>OX-171D quantity differs</strong><p>eBay quantity 8 · local authority 10. Choose one audited disposition.</p></div><button onClick={() => showNotice("Remote quantity accepted in the local audit ledger.")}>Accept remote</button><button onClick={() => showNotice("Local revision draft prepared; approval reset.")}>Prepare local revision</button><button onClick={() => showNotice("Withdrawal confirmation opened.")}>Withdraw</button></div>
        </section>}

        {view === "risk" && <section className="view">
          <SectionHeading eyebrow="Protect · Exceptions open first" title="Risk, policy and returns" body="Every exception has one smallest next action. Ready items remain out of the way." />
          <div className="exception-stack">{exceptionRows.map((row) => <article key={row.sku} className={`exception exception-${row.tone}`}><Badge tone={row.tone}>{row.level}</Badge><div><strong>{row.title}</strong><span>{row.sku}</span><p>{row.detail}</p></div><button onClick={() => row.sku === "VLT-1042" ? openDraft("fitment") : showNotice(`${row.action} opened for ${row.sku}.`)}>{row.action}<Icon name="arrow"/></button></article>)}</div><div className="risk-grid"><article><div><Icon name="alert"/><span><strong>Policy weather</strong><small>1 category change this week</small></span></div><p>Timing Components gained no new required field. One Lighting category aspect changed and reopened the affected draft only.</p><button onClick={() => showNotice("Affected categories list opened.")}>View affected drafts</button></article><article><div><Icon name="live"/><span><strong>Returns-risk signals</strong><small>Advisory unless policy blocks</small></span></div><p>Risk rises with unverified fitment, used condition without defect photos, missing origin for international, and safety-critical keywords.</p><button onClick={() => openDraft("preview")}>Preview buyer contract</button></article><article><div><Icon name="receipt"/><span><strong>Does-not-fit response</strong><small>Evidence reopens automatically</small></span></div><p>A reported mismatch clears the claim, changes the payload hash and quarantines sibling compatibility that shares the same evidence edge.</p><button onClick={() => showNotice("Does-not-fit simulation added to the audit view.")}>Simulate return</button></article></div>
        </section>}

        {view === "evidence" && <section className="view">
          <SectionHeading eyebrow="Proof, not promises" title="Evidence Packs" body="Export the seller-owned chain for a return, VeRO question, recall review, chargeback or internal audit." action={<button className="primary" onClick={() => showNotice("Sample EvidencePack download prepared.")}><Icon name="receipt"/> Export selected</button>} />
          <div className="evidence-layout"><div className="pack-card"><div className="pack-cover"><span>PARTQUILL / EVIDENCE PACK</span><strong>VLT-1042</strong><small>Draft v12 · not published</small><Icon name="shield"/></div><div className="pack-sections">{[ ["Source photographs", "4 originals · SHA-256 retained"], ["Approved derivatives", "1 image · source comparison passed"], ["Identity evidence", "Brand + MPN seller-confirmed"], ["Catalog evidence", "2 exact reference checks · fitment excluded"], ["Approval ledger", "Private preflight pending"], ["Payload history", "12 immutable draft versions"] ].map(([label,value]) => <div key={label}><span>{label}</span><strong>{value}</strong><Icon name="check"/></div>)}</div></div><div className="audit-ledger"><div><span>Audit ledger</span><Badge tone="green">Append-only design</Badge></div>{[ ["04:12", "Seller confirmed physical MPN", "KW"], ["04:09", "Unsupported fitment removed", "System"], ["04:06", "Hero derivative approved", "KW"], ["04:03", "Catalog reference refreshed", "System"], ["03:58", "Draft created from part number", "KW"] ].map(([time,event,actor]) => <article key={`${time}-${event}`}><time>{time}</time><i/><div><strong>{event}</strong><span>{actor}</span></div></article>)}</div></div>
        </section>}

        {view === "settings" && <section className="view">
          <SectionHeading eyebrow="Seller-owned defaults" title="Account and listing rules" body="Reuse the seller’s own choices. Never learn unsupported fitment or marketplace-derived pricing." />
          <div className="settings-layout"><div className="settings-section"><h3>Seller account</h3>{[ ["Seller account", "Private pilot seller"], ["Inventory authority", "PartQuill master"], ["Merchant location", "Confirm before live use"], ["Default return policy", "30 days · buyer-paid"], ["Default domestic shipping", "Seller default"] ].map(([label,value]) => <label key={label}><span>{label}</span><button>{value}<Icon name="arrow"/></button></label>)}</div><div className="settings-section"><h3>Safety and approvals</h3><label className="setting-toggle"><span><strong>Buyer evidence statement</strong><small>Add the optional listing-as-contract footer.</small></span><input type="checkbox" checked={sellerContract} onChange={(event) => setSellerContract(event.target.checked)}/></label><label className="setting-toggle"><span><strong>Quiet-hours publish</strong><small>Hold approved payloads until the chosen local window; recheck fee expiry.</small></span><input type="checkbox" checked={quietHours} onChange={(event) => setQuietHours(event.target.checked)}/></label><label className="setting-toggle"><span><strong>Automatic marketplace repricing</strong><small>Disabled by product policy.</small></span><input type="checkbox" disabled/></label><label className="setting-toggle"><span><strong>Two approval gates</strong><small>Required for every account and plan.</small></span><input type="checkbox" checked readOnly/></label></div><div className="settings-section"><h3>Hard blocks</h3><div className="blocked-tags"><Badge tone="red">Airbags / inflators</Badge><Badge tone="red">Recall matches</Badge><Badge tone="red">Emissions defeat</Badge><Badge tone="red">Counterfeit goods</Badge><Badge tone="red">Third-party watermark removal</Badge><Badge tone="red">Mystery used parts without actual photos</Badge></div><p>Blocked and failed items never consume the seller’s free public-listing allowance.</p></div></div>
        </section>}

        <footer className="app-footer"><span>PartQuill is independent seller software and is not affiliated with or endorsed by eBay.</span><span>Private pilot · Backend connected · eBay writes disabled</span></footer>
      </main>
    </div>
  );
}
