export const PARTQUILL_OEM_WIDGET_URI = 'ui://partquill/oem-part-finder-v3.html';

export function buildPartQuillOemWidgetHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>PartQuill OEM Part Finder</title>
  <style>
    :root { color-scheme:light; --ink:#10241b; --muted:#5d6e65; --green:#087443; --mint:#e8f8ef; --amber:#966200; --amber-bg:#fff6d9; --red:#a32822; --red-bg:#fff0ed; --line:#c8d8cf; --cream:#fbfaf4; }
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
    .status[data-tone=warn] { background:var(--amber-bg); color:var(--amber); }
    .status[data-tone=bad] { background:var(--red-bg); color:var(--red); }
    .result { display:none; margin-top:16px; }
    .result.visible { display:block; }
    .headline { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; padding-bottom:13px; border-bottom:1px solid var(--line); }
    h1 { margin:0; font-size:23px; line-height:1.15; letter-spacing:-.025em; }
    .sub { margin-top:4px; color:var(--muted); }
    .callout { white-space:nowrap; padding:6px 9px; border-radius:9px; background:var(--mint); color:var(--green); font-weight:850; }
    .verdict { display:flex; gap:12px; align-items:center; margin:14px 0; padding:14px 15px; border:2px solid; border-radius:14px; }
    .verdict-icon { display:grid; flex:0 0 34px; place-items:center; width:34px; height:34px; border-radius:50%; color:#fff; font-size:21px; font-weight:900; }
    .verdict strong,.verdict span { display:block; }
    .verdict strong { font-size:17px; line-height:1.2; }
    .verdict span { margin-top:3px; }
    .verdict[data-tone=green] { border-color:#7fc7a1; background:var(--mint); color:#075c37; }
    .verdict[data-tone=green] .verdict-icon { background:var(--green); }
    .verdict[data-tone=amber] { border-color:#e4bf67; background:var(--amber-bg); color:#6d4900; }
    .verdict[data-tone=amber] .verdict-icon { background:var(--amber); }
    .verdict[data-tone=red] { border-color:#e4a49d; background:var(--red-bg); color:#7e211d; }
    .verdict[data-tone=red] .verdict-icon { background:var(--red); }
    .correction { display:none; margin:-3px 0 14px; padding:14px 15px; border:1px solid #e4a49d; border-radius:14px; background:#fffaf8; }
    .correction.visible { display:grid; grid-template-columns:1fr auto; gap:12px; align-items:center; }
    .correction strong,.correction span { display:block; }
    .correction strong { font-size:15px; }
    .correction span { margin-top:4px; color:#6f554f; font-size:12px; }
    .correction button { background:#8c2822; }
    .correction[data-mode=result] { border-color:#7fc7a1; background:var(--mint); }
    .correction[data-mode=result] strong { color:#075c37; }
    .correction[data-mode=result] button { display:none; }
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
    .fitment h2 { margin:0 0 4px; font-size:14px; }
    .fitment p { margin:0 0 8px; color:var(--muted); font-size:12px; }
    .fitment ul { display:grid; grid-template-columns:1fr 1fr; gap:6px 18px; margin:0; padding:0; list-style:none; color:#40534a; }
    .fitment li { padding:6px 0; border-top:1px solid #edf2ef; }
    .more { margin-top:7px; color:var(--muted); font-size:11px; }
    details { margin-top:12px; border:1px solid var(--line); border-radius:11px; background:#fff; }
    summary { padding:10px 12px; color:#334a3f; font-weight:800; cursor:pointer; }
    .research-details { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; padding:0 12px 12px; }
    .research-details div { padding:9px; border-radius:9px; background:#f5f8f6; }
    .research-details b,.research-details span { display:block; }
    .research-details b { color:var(--muted); font-size:10px; text-transform:uppercase; }
    .research-details span { margin-top:3px; font-weight:750; }
    .guard { margin-top:12px; padding:11px 12px; border-left:4px solid #d69a2c; background:#fff8e8; color:#66512a; font-size:12px; }
    @media (max-width:650px) { .lookup { grid-template-columns:1fr; } .facts,.research-details { grid-template-columns:1fr; } .media { grid-template-columns:1fr; } .fitment ul { grid-template-columns:1fr; } .headline { display:block; } .callout { display:inline-block; margin-top:8px; } .correction.visible { grid-template-columns:1fr; } }
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
        <div id="fitment-verdict" class="verdict" data-tone="amber" role="status" aria-live="polite"><div id="verdict-icon" class="verdict-icon">!</div><div><strong id="verdict-title">Fitment not verified</strong><span id="verdict-detail">Enter the buyer VIN above for a vehicle-specific check.</span></div></div>
        <section id="correction" class="correction" aria-live="polite"><div><strong id="correction-title">This part does not fit. Want the right one?</strong><span id="correction-detail">PartQuill can reuse this VIN once to find the exact part in the same family. The seller’s part and listing will not change.</span></div><button id="find-correct" type="button">Find the correct part</button></section>
        <div class="facts"><div class="fact"><b>Part number</b><span id="part-fact"></span></div><div class="fact"><b>Superseded by</b><span id="superseded"></span></div><div class="fact"><b>Diagram callout</b><span id="pnc"></span></div></div>
        <div class="media">
          <figure><div id="photo-frame" class="frame"><span class="image-empty">No product reference photo returned.</span></div><figcaption><b>Exact product reference photo</b>Research-only unless separate publishing rights are confirmed.</figcaption></figure>
          <figure><div id="diagram-frame" class="frame"><span class="image-empty">No catalog diagram returned.</span></div><figcaption><b id="diagram-label">Catalog diagram</b>Internal fitment reference only. Never use as the primary eBay image.</figcaption></figure>
        </div>
        <div class="fitment"><h2>Potential applications</h2><p>Grouped catalog references only. A VIN verdict controls whether fitment can be claimed.</p><ul id="fitment-list"></ul><div id="fitment-more" class="more"></div></div>
        <details><summary>Seller research details</summary><div class="research-details"><div><b>OEM-source range</b><span id="price"></span></div><div><b>Brands found</b><span id="brands"></span></div><div><b>Anonymous checks</b><span id="checks"></span></div></div></details>
        <div class="guard">Catalog condition is not the seller item’s condition. Reference prices are not verified eBay market value. Images are research evidence, and nothing is created or changed on eBay.</div>
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
      var correction = document.getElementById('correction');
      var correctionTitle = document.getElementById('correction-title');
      var correctionDetail = document.getElementById('correction-detail');
      var findCorrect = document.getElementById('find-correct');
      var activeResearch = null;
      var lastVerifiedVin = '';
      var rejectedPartNumber = '';

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
      function renderVerdict(tone, title, detail) {
        var verdict = document.getElementById('fitment-verdict');
        var normalized = tone === 'GREEN' ? 'green' : tone === 'RED' ? 'red' : 'amber';
        verdict.dataset.tone = normalized;
        document.getElementById('verdict-icon').textContent = normalized === 'green' ? '✓' : normalized === 'red' ? '×' : '!';
        document.getElementById('verdict-title').textContent = title;
        document.getElementById('verdict-detail').textContent = detail;
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
      function hideCorrection() {
        correction.classList.remove('visible');
        correction.dataset.mode = 'prompt';
        findCorrect.disabled = false;
      }
      function partFamilyLabel() {
        if (!activeResearch || !activeResearch.identity) return 'part';
        var names = activeResearch.identity.alternateNames || [];
        return names[0] || activeResearch.identity.description || 'part';
      }
      function showCorrectionPrompt(data) {
        correction.classList.add('visible');
        correction.dataset.mode = 'prompt';
        rejectedPartNumber = data.partNumber || partInput.value.trim().toUpperCase();
        var family = partFamilyLabel();
        correctionTitle.textContent = 'This ' + family + ' does not fit. Want the right one?';
        correctionDetail.textContent = lastVerifiedVin
          ? 'PartQuill can reuse this VIN once to find the exact ' + family + '. The seller’s part and listing will not change.'
          : 'Enter the VIN again above to run the correct-part search. The seller’s part and listing will not change.';
        findCorrect.textContent = 'Find the correct ' + family;
        findCorrect.disabled = !lastVerifiedVin;
      }
      function renderResearch(raw, preserveStatus, mediaMeta) {
        var data = structured(raw);
        if (!data.identity || !data.identity.partNumber) return false;
        activeResearch = data;
        if (!preserveStatus) hideCorrection();
        partInput.value = data.identity.partNumber;
        document.getElementById('title').textContent = data.identity.partNumber + ' — ' + data.identity.description;
        document.getElementById('subtitle').textContent = data.identity.replacedBy && data.identity.replacedBy.length ? 'Superseded by ' + data.identity.replacedBy.join(', ') : 'Exact OEM catalog result';
        var callouts = data.imagePresentation && data.imagePresentation.diagramCallouts || data.identity.pncCodes || [];
        document.getElementById('callout').textContent = 'Diagram callout: ' + (callouts.length ? callouts.join(', ') : 'not returned');
        document.getElementById('diagram-label').textContent = 'Catalog diagram · PNC ' + (callouts.length ? callouts.join(', ') : 'not returned');
        document.getElementById('part-fact').textContent = data.identity.partNumber;
        document.getElementById('superseded').textContent = data.identity.replacedBy && data.identity.replacedBy.length ? data.identity.replacedBy.join(', ') : 'None returned';
        document.getElementById('pnc').textContent = callouts.length ? callouts.join(', ') : 'Not returned';
        var initialVerdict = data.fitmentVerdict || {};
        renderVerdict(initialVerdict.tone || 'AMBER', initialVerdict.statusLabel || 'Fitment not verified', initialVerdict.explanation || 'Enter the buyer VIN above for a vehicle-specific check.');
        var pricing = data.pricingReference || data.pricing || {};
        document.getElementById('price').textContent = money(pricing.currentPriceLow) + '–' + money(pricing.currentPriceHigh);
        document.getElementById('brands').textContent = data.brandCoverage && data.brandCoverage.catalogBrands ? data.brandCoverage.catalogBrands.join(', ') : 'not established';
        document.getElementById('checks').textContent = data.catalogChecks ? data.catalogChecks.exactMatches + ' of ' + data.catalogChecks.attempted : 'not returned';
        var list = document.getElementById('fitment-list'); list.textContent = '';
        var applications = Array.isArray(data.applicationSummary) ? data.applicationSummary : [];
        applications.slice(0, 6).forEach(function (application) {
          var li = document.createElement('li');
          li.textContent = (application.yearRanges || []).join(', ') + ' ' + application.make + ' ' + application.model;
          list.appendChild(li);
        });
        if (!applications.length) { var li = document.createElement('li'); li.textContent = 'No potential application groups returned.'; list.appendChild(li); }
        document.getElementById('fitment-more').textContent = applications.length > 6 ? '+' + (applications.length - 6) + ' more grouped applications. Use the VIN check instead of relying on this broad list.' : '';
        renderMedia(mediaMeta || resultMeta(raw));
        result.classList.add('visible');
        if (!preserveStatus) setStatus('Exact part number found. Vehicle fitment remains unverified until the VIN check is completed.', 'warn');
        return true;
      }
      function renderVin(raw) {
        var data = structured(raw);
        if (!data.status || !data.vehicle) return false;
        var engine = data.vehicle.engineModel || (data.vehicle.displacementL ? data.vehicle.displacementL + 'L' : 'engine not decoded');
        var vehicle = data.vehicle.modelYear + ' ' + data.vehicle.make + ' ' + data.vehicle.model + ', ' + engine;
        var detail = vehicle + '. ' + data.explanation + ' VIN ending ' + data.vinLastFour + '.';
        renderVerdict(data.verdictTone || (data.status === 'CATALOG_MATCH' ? 'GREEN' : data.status === 'CATALOG_NO_MATCH' ? 'RED' : 'AMBER'), data.statusLabel, detail);
        setStatus(data.statusLabel + ' — VIN ending ' + data.vinLastFour + '.', data.status === 'CATALOG_MATCH' ? 'good' : data.status === 'CATALOG_NO_MATCH' ? 'bad' : 'warn');
        if (data.status === 'CATALOG_NO_MATCH') showCorrectionPrompt(data); else { hideCorrection(); lastVerifiedVin = ''; }
        return true;
      }
      function renderCorrection(raw) {
        var data = structured(raw);
        if (!data.status || !data.rejectedPartNumber || !data.vinLastFour) return false;
        if (data.status === 'EXACT_MATCH' && data.correctPart) {
          renderResearch(data.correctPart, true, resultMeta(raw));
          var vehicle = data.vehicle.modelYear + ' ' + data.vehicle.make + ' ' + data.vehicle.model;
          renderVerdict('GREEN', 'Correct part for this vehicle', vehicle + '. ' + data.correctPart.identity.partNumber + ' is the unique VIN-filtered ' + data.partFamily + ' match. VIN ending ' + data.vinLastFour + '.');
          correction.classList.add('visible');
          correction.dataset.mode = 'result';
          correctionTitle.textContent = 'Correct part found: ' + data.correctPart.identity.partNumber;
          correctionDetail.textContent = 'The rejected part ' + data.rejectedPartNumber + ' was not substituted into the seller listing. This result is buyer purchase assistance only.';
          setStatus('Correct part found for VIN ending ' + data.vinLastFour + '. Seller listing unchanged.', 'good');
        } else {
          correction.classList.add('visible');
          correction.dataset.mode = 'result';
          renderVerdict('AMBER', data.statusLabel || 'Correct part not verified', data.explanation + ' VIN ending ' + data.vinLastFour + '.');
          correctionTitle.textContent = data.statusLabel || 'Correct part not verified';
          correctionDetail.textContent = data.candidatePartNumbers && data.candidatePartNumbers.length
            ? 'Possible part numbers: ' + data.candidatePartNumbers.join(', ') + '. PartQuill will not choose between them without stronger evidence.'
            : 'No unique replacement was claimed. The seller’s part and listing remain unchanged.';
          setStatus('No unique correct part was claimed. Seller listing unchanged.', 'warn');
        }
        lastVerifiedVin = '';
        return true;
      }
      async function verifyVinIfPresent() {
        var vin = vinInput.value.trim().toUpperCase();
        if (!vin) return;
        if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) { setStatus('Enter a complete 17-character VIN. Letters I, O and Q are not valid.', 'bad'); return; }
        if (!window.openai || !window.openai.callTool) { setStatus('VIN checking requires the connected PartQuill app inside ChatGPT.', 'bad'); return; }
        setStatus('Decoding the VIN and cross-checking three anonymous OEM catalog paths…');
        try {
          lastVerifiedVin = vin;
          rejectedPartNumber = partInput.value.trim().toUpperCase();
          var checked = await window.openai.callTool('verify_oem_part_vin', { part_number:partInput.value.trim(), vin:vin });
          renderVin(checked);
          vinInput.value = '';
        } catch (error) { lastVerifiedVin = ''; renderVerdict('AMBER', 'May fit — not verified', 'VIN verification could not complete, so no compatibility claim was made.'); setStatus('VIN verification could not complete. No compatibility claim was made.', 'warn'); }
      }
      findCorrect.addEventListener('click', async function () {
        if (!lastVerifiedVin || !rejectedPartNumber) { setStatus('Enter the buyer VIN again to run a fresh correct-part search.', 'warn'); return; }
        if (!window.openai || !window.openai.callTool) { setStatus('Correct-part lookup requires the connected PartQuill app inside ChatGPT.', 'bad'); return; }
        findCorrect.disabled = true;
        setStatus('Searching this VIN for one exact ' + partFamilyLabel() + '…');
        try {
          var corrected = await window.openai.callTool('find_correct_oem_part', { rejected_part_number:rejectedPartNumber, vin:lastVerifiedVin });
          if (!renderCorrection(corrected)) throw new Error('missing correct-part result');
        } catch (error) {
          lastVerifiedVin = '';
          correction.dataset.mode = 'result';
          correctionTitle.textContent = 'Correct part not verified';
          correctionDetail.textContent = 'The vehicle-specific search could not establish one exact replacement, so PartQuill made no claim.';
          renderVerdict('AMBER', 'Correct part not verified', 'The correct-part search could not complete. The seller listing was not changed.');
          setStatus('Correct-part search could not complete. Nothing was changed.', 'warn');
        }
      });
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
      if (initialOutput) { renderResearch(initialOutput); renderVin(initialOutput); renderCorrection(initialOutput); }
      window.addEventListener('openai:set_globals', function () {
        var latest = window.openai && window.openai.toolOutput;
        if (latest) { renderResearch(latest); renderVin(latest); renderCorrection(latest); }
      });
    }());
  </script>
</body>
</html>`;
}
