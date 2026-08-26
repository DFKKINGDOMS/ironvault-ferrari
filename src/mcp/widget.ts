import { PARTQUILL_CHATGPT_EDIT_PROMPT } from './prompt.js';

export const PARTQUILL_WIDGET_URI = 'ui://partquill/image-studio-v1.html';
export const PARTQUILL_WIDGET_ORIGIN = 'https://partquill-image-studio.onrender.com';

export function buildPartQuillWidgetHtml(): string {
  const basePrompt = JSON.stringify(PARTQUILL_CHATGPT_EDIT_PROMPT);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>PartQuill Image Studio</title>
  <style>
    :root { color-scheme: light; --ink:#10241b; --green:#117a4b; --mint:#e5f7ec; --line:#b9d1c3; --cream:#fbfaf4; --danger:#a63c2f; }
    * { box-sizing:border-box; }
    body { margin:0; padding:14px; background:var(--cream); color:var(--ink); font:14px/1.45 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    .shell { max-width:760px; margin:auto; border:1px solid var(--line); border-radius:18px; background:white; overflow:hidden; box-shadow:0 12px 36px rgba(16,36,27,.08); }
    header { display:flex; justify-content:space-between; gap:16px; padding:18px 20px; background:var(--ink); color:white; }
    header strong { display:block; font-size:18px; }
    header small { color:#aee8c8; }
    .pill { align-self:flex-start; white-space:nowrap; border:1px solid #3d765a; border-radius:999px; padding:5px 9px; font-size:11px; font-weight:800; color:#8ef0b7; }
    main { padding:20px; }
    h1 { margin:0 0 6px; font-size:25px; line-height:1.15; letter-spacing:-.03em; }
    p { margin:0; color:#54675d; }
    .steps { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin:18px 0; }
    .step { padding:10px; border:1px solid var(--line); border-radius:12px; background:#f8fcf9; }
    .step b { display:block; color:var(--green); font-size:11px; text-transform:uppercase; letter-spacing:.08em; }
    .step span { display:block; margin-top:3px; font-size:12px; }
    .drop { display:block; padding:22px; border:2px dashed #65a881; border-radius:14px; background:var(--mint); text-align:center; cursor:pointer; }
    .drop strong { display:block; font-size:16px; }
    .drop span { color:#49665a; font-size:12px; }
    input[type=file] { position:absolute; opacity:0; pointer-events:none; }
    .files { display:grid; grid-template-columns:repeat(auto-fill,minmax(165px,1fr)); gap:8px; margin:12px 0 0; }
    .file { border:1px solid var(--line); border-radius:10px; padding:9px; min-width:0; background:white; }
    .file b,.file span { display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .file b { font-size:12px; }
    .file span { color:#66786f; font-size:11px; }
    .rights { display:flex; align-items:flex-start; gap:9px; margin:14px 0; padding:12px; border:1px solid #e7cf96; background:#fff9ec; border-radius:12px; }
    .rights input { margin-top:3px; accent-color:var(--green); }
    .rights b { display:block; font-size:12px; }
    .rights span { display:block; color:#746446; font-size:11px; }
    button { width:100%; border:0; border-radius:12px; padding:13px 16px; background:var(--green); color:white; font-weight:850; cursor:pointer; }
    button:disabled { cursor:not-allowed; opacity:.45; }
    .status { margin-top:12px; padding:12px; border-radius:12px; background:#f3f6f4; color:#42574c; font-size:12px; }
    .status[data-tone=error] { color:var(--danger); background:#fff0ed; }
    .results { display:none; margin-top:16px; border-top:1px solid var(--line); padding-top:16px; }
    .results.visible { display:block; }
    .result-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:10px; margin-top:10px; }
    .result-grid figure { margin:0; border:1px solid var(--line); border-radius:12px; overflow:hidden; background:white; }
    .result-grid img { display:block; width:100%; aspect-ratio:1; object-fit:contain; background:white; }
    .result-grid figcaption { padding:7px; font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    footer { padding:12px 20px; border-top:1px solid var(--line); background:#f6faf7; color:#5a6c62; font-size:11px; }
    @media (max-width:560px) { .steps { grid-template-columns:1fr; } header { align-items:flex-start; } }
  </style>
</head>
<body>
  <section class="shell">
    <header><div><strong>PartQuill Image Studio</strong><small>Connected ChatGPT proof · originals preserved</small></div><span class="pill">FREE ASSIST</span></header>
    <main>
      <h1>Upload once. Edit in this conversation.</h1>
      <p>PartQuill attaches the exact preservation contract automatically. No second tab, copied prompt or repeat upload.</p>
      <div class="steps"><div class="step"><b>1 · Select</b><span>Add 1–24 seller-authorized images.</span></div><div class="step"><b>2 · Send</b><span>One button posts the protected edit job.</span></div><div class="step"><b>3 · Review</b><span>Keep original and derivative side by side.</span></div></div>
      <label class="drop" for="source-files"><strong id="drop-title">Choose the complete photo set</strong><span id="drop-subtitle">JPG, PNG or WebP · up to 24 images</span></label>
      <input id="source-files" type="file" accept="image/jpeg,image/png,image/webp" multiple />
      <div id="files" class="files"></div>
      <label class="rights"><input id="rights" type="checkbox" /><span><b>I photographed these images or have written permission to edit them.</b><span>PartQuill will not process unknown third-party images or remove an unauthorized watermark.</span></span></label>
      <button id="start" disabled>Start protected edit</button>
      <div id="status" class="status">Waiting for an image set. Nothing has been sent.</div>
      <section id="results" class="results"><h2>Returned results</h2><p id="result-summary"></p><div id="result-grid" class="result-grid"></div></section>
    </main>
    <footer>No eBay write occurs here. Edited images remain presentation derivatives and never become identity or fitment evidence.</footer>
  </section>
  <script>
    (function () {
      var MAX_IMAGES = 24;
      var BASE_PROMPT = ${basePrompt};
      var input = document.getElementById('source-files');
      var rights = document.getElementById('rights');
      var start = document.getElementById('start');
      var filesBox = document.getElementById('files');
      var status = document.getElementById('status');
      var title = document.getElementById('drop-title');
      var subtitle = document.getElementById('drop-subtitle');
      var uploads = [];

      function setStatus(message, tone) {
        status.textContent = message;
        status.dataset.tone = tone || 'normal';
      }

      function renderFiles() {
        filesBox.innerHTML = '';
        uploads.forEach(function (item, index) {
          var card = document.createElement('div');
          card.className = 'file';
          var name = document.createElement('b');
          name.textContent = String(index + 1) + '. ' + item.name;
          var note = document.createElement('span');
          note.textContent = item.status;
          card.appendChild(name);
          card.appendChild(note);
          filesBox.appendChild(card);
        });
        title.textContent = uploads.length ? String(uploads.length) + ' image' + (uploads.length === 1 ? '' : 's') + ' ready' : 'Choose the complete photo set';
        subtitle.textContent = uploads.length ? 'Source order is locked to the order shown' : 'JPG, PNG or WebP · up to 24 images';
        start.disabled = !(uploads.length && rights.checked && uploads.every(function (item) { return item.fileId; }));
      }

      function jobCode() {
        return 'PQ-C-' + Date.now().toString(36).toUpperCase().slice(-7);
      }

      function buildPrompt(code) {
        var manifest = uploads.map(function (item, index) { return String(index + 1) + '. ' + item.name; }).join('\n');
        return 'PARTQUILL IMAGE JOB: ' + code + '\nSOURCE COUNT: ' + uploads.length + '\n\n' + BASE_PROMPT + '\n\nPARTQUILL LISTING-SET RULES:\n- Treat every attached image as a separate source and return one separate finished derivative per source.\n- Never merge angles, combine parts, change the quantity shown or create a collage.\n- Keep the same numbered order. Continue until every possible source has a separate finished image.\n- Do not stop after describing the work or giving a written summary.\n\nSOURCE ORDER:\n' + manifest + '\n\nWHEN THE EDITS ARE COMPLETE:\n1. Keep every finished image as a separate output in the same numbered order.\n2. Call the PartQuill return_edited_images tool with job_code ' + code + ' and every completed image if this ChatGPT session exposes the generated files to tools.\n3. If automatic tool return is unavailable, leave every result in this same conversation and state: "PartQuill automatic return is unavailable in this host session."\n4. If any source cannot be edited faithfully, identify that source number as unresolved instead of inventing a replacement.';
      }

      input.addEventListener('change', async function () {
        var selected = Array.prototype.slice.call(input.files || []).slice(0, MAX_IMAGES);
        uploads = selected.map(function (file) { return { name:file.name, type:file.type, file:file, fileId:null, status:'waiting' }; });
        renderFiles();
        if (!window.openai || !window.openai.uploadFile) {
          setStatus('This connected uploader must run inside ChatGPT. The external browser prototype cannot reuse files.', 'error');
          return;
        }
        start.disabled = true;
        for (var index = 0; index < uploads.length; index += 1) {
          var item = uploads[index];
          item.status = 'uploading to this ChatGPT conversation';
          renderFiles();
          try {
            var uploaded = await window.openai.uploadFile(item.file, { library:false });
            item.fileId = uploaded.fileId;
            item.status = 'attached once';
          } catch (error) {
            item.status = 'upload failed';
            setStatus('One or more files could not be attached. Remove the set and try again.', 'error');
          }
          renderFiles();
        }
        if (uploads.every(function (item) { return item.fileId; })) setStatus('All originals are attached to this conversation. Confirm ownership, then start the protected edit.');
      });

      rights.addEventListener('change', renderFiles);

      start.addEventListener('click', async function () {
        if (!window.openai || !window.openai.sendFollowUpMessage || !window.openai.setWidgetState) {
          setStatus('The required ChatGPT message bridge is unavailable in this host.', 'error');
          return;
        }
        var code = jobCode();
        start.disabled = true;
        setStatus('Starting ' + code + ' in this conversation…');
        window.openai.setWidgetState({
          modelContent: 'PartQuill protected image job ' + code + ' contains ' + uploads.length + ' seller-authorized source images. Apply the exact preservation contract and return one output per source.',
          privateContent: { jobCode:code, sources:uploads.map(function (item) { return { fileId:item.fileId, fileName:item.name }; }) },
          imageIds: uploads.map(function (item) { return item.fileId; })
        });
        try {
          await window.openai.sendFollowUpMessage({ prompt:buildPrompt(code), scrollToBottom:true });
          setStatus(code + ' was posted with the exact preservation prompt. Stay in this conversation while ChatGPT edits the set.');
        } catch (error) {
          start.disabled = false;
          setStatus('ChatGPT did not accept the protected job. Your originals remain attached and nothing was lost.', 'error');
        }
      });

      async function renderReturnedFiles() {
        if (!window.openai) return;
        var raw = window.openai.toolOutput || {};
        var output = raw.structuredContent || raw;
        var returned = output.returned_files || output.returnedFiles || [];
        if (!Array.isArray(returned) || !returned.length || !window.openai.getFileDownloadUrl) return;
        var results = document.getElementById('results');
        var summary = document.getElementById('result-summary');
        var grid = document.getElementById('result-grid');
        results.classList.add('visible');
        summary.textContent = String(returned.length) + ' finished image' + (returned.length === 1 ? '' : 's') + ' returned to ' + (output.job_code || output.jobCode || 'this PartQuill job') + '.';
        for (var index = 0; index < returned.length; index += 1) {
          var item = returned[index];
          try {
            var link = await window.openai.getFileDownloadUrl({ fileId:item.file_id || item.fileId });
            var figure = document.createElement('figure');
            var image = document.createElement('img');
            image.src = link.downloadUrl;
            image.alt = 'Returned PartQuill derivative ' + String(index + 1);
            var caption = document.createElement('figcaption');
            caption.textContent = String(index + 1) + '. ' + (item.file_name || item.fileName || 'finished image');
            figure.appendChild(image);
            figure.appendChild(caption);
            grid.appendChild(figure);
          } catch (error) {
            setStatus('The returned files were recorded, but ChatGPT did not provide a fresh preview URL.', 'error');
          }
        }
      }

      renderFiles();
      void renderReturnedFiles();
    }());
  </script>
</body>
</html>`;
}
