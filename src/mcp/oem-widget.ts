export const PARTQUILL_OEM_WIDGET_URI = 'ui://partquill/oem-part-finder-v1.html';

export function buildPartQuillOemWidgetHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>PartQuill OEM Part Finder</title>
  <style>
    :root { color-scheme:light; --ink:#10241b; --muted:#5d6e65; --green:#117a4b; --mint:#e9f8ef; --line:#c8d8cf; --cream:#fbfaf4; --warn:#895d14; --bad:#a63c2f; }
    * { box-sizing:border-box; }
    body { margin:0; padding:12px; color:var(--ink); background:var(--cream); font:14px/1.45 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    .shell { max-width:820px; margin:auto; overflow:hidden; border:1px solid var(--line); border-radius:18px; background:#fff; box-shadow:0 12px 32px rgba(16,36,27,.08); }
    header { display:flex; justify-content:space-between; gap:12px; padding:17px 20px; color:#fff; background:var(--ink); }
    header strong { display:block; font-size:18px; }
    header small { color:#aee8c8; }
    .badge { align-self:flex-start; padding:5px 9px; border:1px solid #3d765a; border-radius:999px; color:#8ef0b7; font-size:11px; font-weight:800; }
    main { padding:18px 20px 22px; }
    .lookup { display:grid; grid-template-columns:1fr 1.25fr auto; gap:9px; align-items:end; }
    label span { display:block; margin:0 0 5px; color:var(--muted); font-size:11px; font-weight:750; text-transform:uppercase; letter-spacing:.06em; }
    input { width:100%; height:43px; padding:0 12px; border:1px solid var(--line); border-radius:10px; color:var(--ink); background:#fff; font:inherit; text-transform:uppercase; }
    input:focus { outline:3px solid rgba(17,122,75,.14); border-color:var(--green); }
    button { min-height:43px; padding:0 16px; border:0; border-radius:10px; color:#fff; background:var(--green); font-weight:850; cursor:pointer; }
    button:disabled { opacity:.5; cursor:not-allowed; }
    .privacy { margin:8px 0 0; color:var(--muted); font-size:11px; }
    .status { margin-top:12px; padding:11px 12px; border-radius:11px; background:#f2f6f3; color:#3f554a; }
    .status[data-tone=good] { background:var(--mint); color:#0a683d; }
    .status[data-tone=warn] { background:#fff6df; color:var(--warn); }
    .status[data-tone=bad] { background:#fff0ed; color:var(--bad); }
    .result { display:none; margin-top:16px; }
    .result.visible { display:block; }
    .headline { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; padding-bottom:13px; border-bottom:1px solid var(--line); }
    h1 { margin:0; font-size:23px; line-height:1.15; letter-spacing:-.025em; }
    .sub { margin-top:4px; color:var(--muted); }
    .callout { white-space:nowrap; padding:6px 9px; border-radius:9px; background:var(--mint); color:var(--green); font-weight:850; }
    .facts { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin:13px 0; }
    .fact { padding:10px; border:1px solid var(--line); border-radius:11px; background:#fbfdfb; }
    .fact b,.fact span { display:block; }
    .fact b { color:var(--muted); font-size:10px; text-transform:uppercase; letter-spacing:.06em; }
    .fact span { margin-top:3px; font-weight:800; }
    .media { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
    figure { margin:0; overflow:hidden; border:1px solid var(--line); border-radius:13px; background:#fff; }
    .frame { position:relative; display:grid; place-items:center; min-height:230px; padding:10px; background:#fff; }
    figure img { display:block; max-width:100%; width:100%; height:230px; object-fit:contain; }
    figure figcaption { padding:9px 11px; border-top:1px solid var(--line); color:var(--muted); font-size:11px; }
    figure figcaption b { display:block; color:var(--ink); font-size:12px; }
    .image-empty { color:var(--muted); text-align:center; }
    .fitment { margin-top:13px; padding:12px; border:1px solid var(--line); border-radius:12px; background:#fbfdfb; }
    .fitment h2 { margin:0 0 7px; font-size:14px; }
    .fitment ul { margin:0; padding-left:18px; color:#40534a; }
    .guard { margin-top:12px; padding:11px 12px; border-left:4px solid #d69a2c; background:#fff8e8; color:#66512a; font-size:12px; }
    @media (max-width:650px) { .lookup { grid-template-columns:1fr; } .facts { grid-template-columns:1fr; } .media { grid-template-columns:1fr; } .headline { display:block; } .callout { display:inline-block; margin-top:8px; } }
  </style>
</head>
<body>
  <section class="shell">
    <header><div><strong>PartQuill OEM Part Finder</strong><small>Toyota · Lexus · Scion · anonymous catalog research</small></div><span class="badge">READ ONLY</span></header>
    <main>
      <div class="lookup">
        <label><span>OEM part number</span><input id="part-number" maxlength="40" placeholder="13568-29025" autocomplete="off" /></label>
        <label><span>Buyer VIN (optional)</span><input id="vin" maxlength="17" placeholder="17-character VIN" autocomplete="off" /></label>
        <button id="lookup">Find part</button>
      </div>
      <p class="privacy">A VIN is used only for this lookup, is returned masked, and is not stored by PartQuill. No source/dealer identity is shown.</p>
      <div id="status" class="status">Enter a part number. Add a VIN when the buyer wants a vehicle-specific catalog cross-check.</div>
      <section id="result" class="result">
        <div class="headline"><div><h1 id="title"></h1><div id="subtitle" class="sub"></div></div><div id="callout" class="callout"></div></div>
        <div class="facts"><div class="fact"><b>Observed OEM range</b><span id="price"></span></div><div class="fact"><b>Brands found</b><span id="brands"></span></div><div class="fact"><b>Exact catalog checks</b><span id="checks"></span></div></div>
        <div class="media">
          <figure><div id="photo-frame" class="frame"><span class="image-empty">No product reference photo returned.</span></div><figcaption><b>Exact product reference photo</b>Research-only unless separate publishing rights are confirmed.</figcaption></figure>
          <figure><div id="diagram-frame" class="frame"><span class="image-empty">No catalog diagram returned.</span></div><figcaption><b id="diagram-label">Catalog diagram</b>Internal fitment reference only. Never use as the primary eBay image.</figcaption></figure>
        </div>
        <div class="fitment"><h2>Catalog fitment preview</h2><ul id="fitment-list"></ul></div>
        <div class="guard">Images are reference evidence—not seller photographs. No eBay listing is created or changed. Broad fitment remains blocked unless the VIN result reaches “Fits catalog evidence.”</div>
      </section>
    </main>
  </section>
  <script>
    (function () {
      var partInput = document.getElementById('part-number');
      var vinInput = document.getElementById('vin');
      var lookup = document.getElementById('lookup');
      var status = document.getElementById('status');
      var result = document.getElementById('result');
      var activeResearch = null;

      function setStatus(message, tone) { status.textContent = message; status.dataset.tone = tone || 'normal'; }
      function money(value) { return typeof value === 'number' ? '$' + value.toFixed(2) : 'not returned'; }
      function envelope(value) { return value && typeof value === 'object' ? value : {}; }
      function structured(value) {
        var root = envelope(value);
        return envelope(root.structuredContent || root.structured_content || root);
      }
      function resultMeta(value) {
        var root = envelope(value);
        var responseMeta = envelope(root._meta || root.meta || (window.openai && window.openai.toolResponseMetadata));
        var mcp = envelope(responseMeta.mcp_tool_result || responseMeta.call_tool_result || responseMeta.mcpToolResult || responseMeta.callToolResult);
        return envelope(mcp._meta || responseMeta.partquillMedia && responseMeta || root._meta);
      }
      function clearFrame(id, fallback) {
        var frame = document.getElementById(id); frame.textContent = '';
        var empty = document.createElement('span'); empty.className = 'image-empty'; empty.textContent = fallback; frame.appendChild(empty);
      }
      function renderMedia(meta) {
        clearFrame('photo-frame', 'No product reference photo returned.');
        clearFrame('diagram-frame', 'No catalog diagram returned.');
        var media = envelope(meta).partquillMedia || envelope(meta).partquill_media || [];
        if (!Array.isArray(media)) media = [];
        media.forEach(function (item) {
          var target = item.role === 'CATALOG_DIAGRAM' ? 'diagram-frame' : item.role === 'PRODUCT_PHOTO' ? 'photo-frame' : null;
          if (!target || !item.data || !item.mimeType) return;
          var frame = document.getElementById(target); frame.textContent = '';
          var image = document.createElement('img');
          image.src = 'data:' + item.mimeType + ';base64,' + item.data;
          image.alt = item.alt || (item.role === 'CATALOG_DIAGRAM' ? 'Catalog diagram' : 'Exact product reference photograph');
          frame.appendChild(image);
        });
      }
      function renderResearch(raw) {
        var data = structured(raw);
        if (!data.identity || !data.identity.partNumber) return false;
        activeResearch = data;
        partInput.value = data.identity.partNumber;
        document.getElementById('title').textContent = data.identity.partNumber + ' — ' + data.identity.description;
        document.getElementById('subtitle').textContent = data.identity.replacedBy && data.identity.replacedBy.length ? 'Superseded by ' + data.identity.replacedBy.join(', ') : 'Exact OEM catalog result';
        var callouts = data.imagePresentation && data.imagePresentation.diagramCallouts || data.identity.pncCodes || [];
        document.getElementById('callout').textContent = 'Diagram callout: ' + (callouts.length ? callouts.join(', ') : 'not returned');
        document.getElementById('diagram-label').textContent = 'Catalog diagram · PNC ' + (callouts.length ? callouts.join(', ') : 'not returned');
        var pricing = data.pricing || {};
        document.getElementById('price').textContent = money(pricing.currentPriceLow) + '–' + money(pricing.currentPriceHigh);
        document.getElementById('brands').textContent = data.brandCoverage && data.brandCoverage.catalogBrands ? data.brandCoverage.catalogBrands.join(', ') : 'not established';
        document.getElementById('checks').textContent = data.catalogChecks ? data.catalogChecks.exactMatches + ' of ' + data.catalogChecks.attempted : 'not returned';
        var list = document.getElementById('fitment-list'); list.textContent = '';
        (data.fitment || []).slice(0, 8).forEach(function (row) { var li = document.createElement('li'); li.textContent = row.raw; list.appendChild(li); });
        if (!(data.fitment || []).length) { var li = document.createElement('li'); li.textContent = 'No exact fitment rows returned.'; list.appendChild(li); }
        renderMedia(resultMeta(raw));
        result.classList.add('visible');
        setStatus('Part found. ' + ((data.imagePresentation && data.imagePresentation.productPhotoAvailable) ? 'The product photo and diagram are displayed below.' : 'Reference media availability is shown below.'), 'good');
        return true;
      }
      function renderVin(raw) {
        var data = structured(raw);
        if (!data.status || !data.vehicle) return false;
        var engine = data.vehicle.engineModel || (data.vehicle.displacementL ? data.vehicle.displacementL + 'L' : 'engine not decoded');
        var message = data.statusLabel + ' — ' + data.vehicle.modelYear + ' ' + data.vehicle.make + ' ' + data.vehicle.model + ', ' + engine + '. ' + data.explanation + ' VIN ending ' + data.vinLastFour + '.';
        setStatus(message, data.status === 'CATALOG_MATCH' ? 'good' : data.status === 'CATALOG_NO_MATCH' ? 'bad' : 'warn');
        return true;
      }
      async function verifyVinIfPresent() {
        var vin = vinInput.value.trim().toUpperCase();
        if (!vin) return;
        if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) { setStatus('Enter a complete 17-character VIN. Letters I, O and Q are not valid.', 'bad'); return; }
        if (!window.openai || !window.openai.callTool) { setStatus('VIN checking requires the connected PartQuill app inside ChatGPT.', 'bad'); return; }
        setStatus('Decoding the VIN and cross-checking three anonymous OEM catalog paths…');
        try {
          var checked = await window.openai.callTool('verify_oem_part_vin', { part_number:partInput.value.trim(), vin:vin });
          renderVin(checked);
        } catch (error) { setStatus('VIN verification could not complete. No compatibility claim was made.', 'bad'); }
      }
      lookup.addEventListener('click', async function () {
        var part = partInput.value.trim().toUpperCase();
        if (!/^[A-Z0-9][A-Z0-9-]{3,38}[A-Z0-9]$/.test(part)) { setStatus('Enter an exact OEM part number using letters, numbers and hyphens.', 'bad'); return; }
        if (!window.openai || !window.openai.callTool) { setStatus('Part research requires the connected PartQuill app inside ChatGPT.', 'bad'); return; }
        lookup.disabled = true; setStatus('Checking three private catalog paths without exposing their identities…');
        try {
          var researched = await window.openai.callTool('research_oem_part', { part_number:part, quick_sale_discount_percent:20 });
          if (!renderResearch(researched)) throw new Error('missing research result');
          await verifyVinIfPresent();
        } catch (error) { setStatus('No exact anonymous OEM result was returned. Nothing was written to eBay.', 'bad'); }
        lookup.disabled = false;
      });
      vinInput.addEventListener('keydown', function (event) { if (event.key === 'Enter') lookup.click(); });
      partInput.addEventListener('keydown', function (event) { if (event.key === 'Enter') lookup.click(); });
      var initialOutput = window.openai && window.openai.toolOutput;
      if (initialOutput) { renderResearch(initialOutput); renderVin(initialOutput); }
      window.addEventListener('openai:set_globals', function () {
        var latest = window.openai && window.openai.toolOutput;
        if (latest && latest !== activeResearch) { renderResearch(latest); renderVin(latest); }
      });
    }());
  </script>
</body>
</html>`;
}
